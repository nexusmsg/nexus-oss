package queue

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
)

const testIDempotencyPrefix = "itest-queue-"

// TestStoreIntegration exercises the queue store against a real Postgres
// database. It is gated by TEST_DATABASE_URL and skipped when unset.
func TestStoreIntegration(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping queue store integration test")
	}
	ctx := context.Background()

	migrationsDir, err := findMigrationsDir()
	if err != nil {
		t.Fatalf("locate migrations: %v", err)
	}
	migrator, err := migrate.New("file://"+filepath.ToSlash(migrationsDir), dsn)
	if err != nil {
		t.Fatalf("create migrator: %v", err)
	}
	defer func() { _, _ = migrator.Close() }()
	if err := migrator.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		t.Fatalf("apply migrations: %v", err)
	}

	store, err := NewStore(ctx, dsn, "jobs", log.Default())
	if err != nil {
		t.Fatalf("NewStore() error = %v", err)
	}

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("create test pool: %v", err)
	}

	prefix := fmt.Sprintf("%s%d-", testIDempotencyPrefix, time.Now().UnixNano())
	if _, err := pool.Exec(ctx, "delete from jobs where idempotency_key like $1", prefix+"%"); err != nil {
		t.Fatalf("pre-test cleanup: %v", err)
	}
	// t.Cleanup runs in last-added-first order: the row cleanup is registered
	// last so it runs before the pools are closed.
	t.Cleanup(pool.Close)
	t.Cleanup(store.Close)
	t.Cleanup(func() {
		if _, err := pool.Exec(ctx, "delete from jobs where idempotency_key like $1", prefix+"%"); err != nil {
			t.Logf("cleanup: %v", err)
		}
	})

	validPayload := `{"messaging_product":"whatsapp","to":"628123456789","type":"text","text":{"body":"hello"}}`

	t.Run("claim and complete", func(t *testing.T) {
		serial := insertJob(t, ctx, pool, prefix+"claim-complete", "phone-100", validPayload)

		jobs, err := store.Claim(ctx, 10)
		if err != nil {
			t.Fatalf("Claim() error = %v", err)
		}
		job := findJob(jobs, serial)
		if job == nil {
			t.Fatalf("claimed jobs = %+v, want serial %s", jobs, serial)
		}
		if job.Status != domain.JobStatusClaimed {
			t.Errorf("status = %q, want %q", job.Status, domain.JobStatusClaimed)
		}
		if job.Attempts != 1 {
			t.Errorf("attempts = %d, want 1", job.Attempts)
		}
		if job.PhoneNumberID != "phone-100" {
			t.Errorf("phone_number_id = %q", job.PhoneNumberID)
		}
		if job.Type != domain.JobTypeSendMessage {
			t.Errorf("type = %q", job.Type)
		}

		if err := store.Complete(ctx, serial, domain.JobResult{WA_MESSAGE_ID: "wamid-itest"}); err != nil {
			t.Fatalf("Complete() error = %v", err)
		}
		var status string
		var resultJSON []byte
		if err := pool.QueryRow(ctx,
			"select status, result from jobs where serial = $1", serial,
		).Scan(&status, &resultJSON); err != nil {
			t.Fatalf("query completed job: %v", err)
		}
		if status != domain.JobStatusSucceeded {
			t.Errorf("status = %q, want %q", status, domain.JobStatusSucceeded)
		}
		var result map[string]string
		if err := json.Unmarshal(resultJSON, &result); err != nil {
			t.Fatalf("decode result: %v", err)
		}
		if result["wa_message_id"] != "wamid-itest" {
			t.Errorf("result = %v, want wa_message_id = wamid-itest", result)
		}
	})

	t.Run("retry later", func(t *testing.T) {
		serial := insertJob(t, ctx, pool, prefix+"retry", "phone-101", validPayload)
		claimAndFind(t, ctx, store, serial)

		nextAvailableAt := time.Now().Add(2 * time.Second)
		if err := store.RetryLater(ctx, serial, nextAvailableAt, errors.New("temporary failure")); err != nil {
			t.Fatalf("RetryLater() error = %v", err)
		}
		var status string
		var availableAt time.Time
		var lastError, claimedBy *string
		var claimedAt *time.Time
		if err := pool.QueryRow(ctx, `
			select status, available_at, last_error, claimed_by, claimed_at
			from jobs where serial = $1`, serial,
		).Scan(&status, &availableAt, &lastError, &claimedBy, &claimedAt); err != nil {
			t.Fatalf("query retried job: %v", err)
		}
		if status != domain.JobStatusPending {
			t.Errorf("status = %q, want %q", status, domain.JobStatusPending)
		}
		if !availableAt.After(time.Now()) {
			t.Errorf("available_at = %v, want in the future", availableAt)
		}
		if lastError == nil || *lastError != "temporary failure" {
			t.Errorf("last_error = %v", lastError)
		}
		if claimedBy != nil || claimedAt != nil {
			t.Errorf("claimed_by = %v, claimed_at = %v, want null after retry", claimedBy, claimedAt)
		}
	})

	t.Run("fail", func(t *testing.T) {
		serial := insertJob(t, ctx, pool, prefix+"fail", "phone-102", validPayload)
		claimAndFind(t, ctx, store, serial)

		if err := store.Fail(ctx, serial, errors.New("permanent failure")); err != nil {
			t.Fatalf("Fail() error = %v", err)
		}
		var status string
		var lastError *string
		var completedAt *time.Time
		if err := pool.QueryRow(ctx, `
			select status, last_error, completed_at
			from jobs where serial = $1`, serial,
		).Scan(&status, &lastError, &completedAt); err != nil {
			t.Fatalf("query failed job: %v", err)
		}
		if status != domain.JobStatusFailed {
			t.Errorf("status = %q, want %q", status, domain.JobStatusFailed)
		}
		if lastError == nil || *lastError != "permanent failure" {
			t.Errorf("last_error = %v", lastError)
		}
		if completedAt == nil {
			t.Errorf("completed_at is null, want set")
		}
	})
}

func insertJob(t *testing.T, ctx context.Context, pool *pgxpool.Pool, idempotencyKey, phoneNumberID, payload string) string {
	t.Helper()
	var serial string
	err := pool.QueryRow(ctx, `
		insert into jobs (type, phone_number_id, payload, idempotency_key)
		values ('send_message', $1, $2::jsonb, $3)
		returning serial`, phoneNumberID, payload, idempotencyKey).Scan(&serial)
	if err != nil {
		t.Fatalf("insert job: %v", err)
	}
	return serial
}

func claimAndFind(t *testing.T, ctx context.Context, store *Store, serial string) domain.Job {
	t.Helper()
	jobs, err := store.Claim(ctx, 10)
	if err != nil {
		t.Fatalf("Claim() error = %v", err)
	}
	job := findJob(jobs, serial)
	if job == nil {
		t.Fatalf("claimed jobs = %+v, want serial %s", jobs, serial)
	}
	return *job
}

func findJob(jobs []domain.Job, serial string) *domain.Job {
	for i := range jobs {
		if jobs[i].Serial == serial {
			return &jobs[i]
		}
	}
	return nil
}

// findMigrationsDir walks up from the package directory until it finds the
// repository's shared/db/migrations directory.
func findMigrationsDir() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		candidate := filepath.Join(dir, "shared", "db", "migrations")
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return candidate, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("shared/db/migrations not found above %s", dir)
		}
		dir = parent
	}
}
