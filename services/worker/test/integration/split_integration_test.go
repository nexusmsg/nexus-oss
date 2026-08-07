//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/afikrim/waba-api-unofficial/internal/adapters/queue"
	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
	"github.com/afikrim/waba-api-unofficial/internal/handlers/channel"
	"github.com/afikrim/waba-api-unofficial/internal/service"
)

const testSplitPrefix = "itest-split-"

// splitSetup prepares a real Postgres for the split DB contract tests,
// mirroring store_integration_test.go: it skips when TEST_DATABASE_URL is
// unset, applies the shared migrations, and registers prefix-based cleanup of
// the rows this run creates. Both Stores share one pool, as cmd/worker/main.go
// does: the jobs Store owns the pool, the whatsmeow_jobs Store shares it.
func splitSetup(t *testing.T) (jobsStore *queue.Store, whatsmeowStore *queue.Store, pool *pgxpool.Pool, prefix string) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping split DB contract integration test")
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

	jobsStore, err = queue.NewStore(ctx, dsn, "jobs", log.Default())
	if err != nil {
		t.Fatalf("NewStore(jobs) error = %v", err)
	}
	whatsmeowStore = queue.NewStoreWithPool(jobsStore.Pool(), "whatsmeow_jobs", log.Default())
	pool = jobsStore.Pool()

	prefix = fmt.Sprintf("%s%d-", testSplitPrefix, time.Now().UnixNano())
	// t.Cleanup runs in last-added-first order: the row cleanup is registered
	// last so it runs before the owned pool is closed.
	t.Cleanup(jobsStore.Close)
	t.Cleanup(func() {
		for _, table := range []string{"whatsmeow_jobs", "jobs"} {
			if _, err := pool.Exec(ctx, "delete from "+table+" where idempotency_key like $1", prefix+"%"); err != nil {
				t.Logf("cleanup %s: %v", table, err)
			}
		}
	})
	return jobsStore, whatsmeowStore, pool, prefix
}

// validSendMessagePayload marshals a real, valid OutboundMessage text payload
// (the same shape store_integration_test.go inserts as a raw string).
func validSendMessagePayload(t *testing.T) []byte {
	t.Helper()
	payload, err := json.Marshal(entity.OutboundMessage{
		MessagingProduct: "whatsapp",
		To:               "628123456789",
		Type:             "text",
		Text:             &entity.Text{Body: "hello"},
	})
	if err != nil {
		t.Fatalf("marshal outbound message: %v", err)
	}
	return payload
}

// waitFor polls cond until it returns true or the deadline passes.
func waitFor(t *testing.T, timeout, step time.Duration, what string, cond func() (bool, error)) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		ok, err := cond()
		if err != nil {
			t.Fatalf("wait for %s: %v", what, err)
		}
		if ok {
			return
		}
		time.Sleep(step)
	}
	t.Fatalf("timed out after %s waiting for %s", timeout, what)
}

// TestSplitDispatchContractRealDB verifies the stateless dispatcher's DB
// contract: a jobs row claimed by the consumer is forwarded into
// whatsmeow_jobs with source_job_serial = the original jobs serial, and the
// dispatcher leaves the jobs row 'claimed' (no Complete/Retry/Fail) so the
// executor can write the terminal status back later.
func TestSplitDispatchContractRealDB(t *testing.T) {
	jobsStore, whatsmeowStore, pool, prefix := splitSetup(t)
	ctx := context.Background()

	payload := validSendMessagePayload(t)
	serial, err := jobsStore.Enqueue(ctx, entity.Job{
		Type:           entity.JobTypeSendMessage,
		PhoneNumberID:  "phone-split-dispatch",
		Payload:        payload,
		IDempotencyKey: prefix + "dispatch",
	})
	if err != nil {
		t.Fatalf("jobsStore.Enqueue() error = %v", err)
	}

	dispatcher := service.NewDispatcher(whatsmeowStore, log.Default())
	consumer := channel.NewConsumer(jobsStore, dispatcher, 50*time.Millisecond, entity.DefaultMaxAttempts, log.Default())

	consumerCtx, cancel := context.WithCancel(ctx)
	consumerErr := make(chan error, 1)
	go func() { consumerErr <- consumer.Run(consumerCtx) }()
	// Cancel even if an assertion fails below so the goroutine always exits.
	t.Cleanup(cancel)

	waitFor(t, 5*time.Second, 50*time.Millisecond, "jobs row claimed and forwarded to whatsmeow_jobs", func() (bool, error) {
		var status string
		if err := pool.QueryRow(ctx, "select status from jobs where serial = $1", serial).Scan(&status); err != nil {
			return false, err
		}
		if status != entity.JobStatusClaimed {
			return false, nil
		}
		var forwardedSerial string
		err := pool.QueryRow(ctx,
			"select serial from whatsmeow_jobs where source_job_serial = $1", serial,
		).Scan(&forwardedSerial)
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		return true, nil
	})

	// The dispatcher copies the job into whatsmeow_jobs under a new serial.
	var forwardedSerial, forwardedStatus string
	var forwardedPayload []byte
	if err := pool.QueryRow(ctx, `
		select serial, status, payload from whatsmeow_jobs where source_job_serial = $1`, serial,
	).Scan(&forwardedSerial, &forwardedStatus, &forwardedPayload); err != nil {
		t.Fatalf("query forwarded whatsmeow job: %v", err)
	}
	if forwardedSerial == "" || forwardedSerial == serial {
		t.Errorf("forwarded serial = %q, want a distinct uuid from jobs serial %q", forwardedSerial, serial)
	}
	if string(forwardedPayload) != string(payload) {
		// The jobs table stores payload as jsonb, which re-serializes JSON
		// key order and whitespace, so a raw byte comparison can never match
		// after the round-trip; compare the decoded message instead.
		var forwardedMsg, originalMsg entity.OutboundMessage
		if err := json.Unmarshal(forwardedPayload, &forwardedMsg); err != nil {
			t.Fatalf("decode forwarded payload: %v", err)
		}
		if err := json.Unmarshal(payload, &originalMsg); err != nil {
			t.Fatalf("decode original payload: %v", err)
		}
		if !reflect.DeepEqual(forwardedMsg, originalMsg) {
			t.Errorf("forwarded payload = %s, want the original message %s", forwardedPayload, payload)
		}
	}
	// The dispatcher enqueues it as pending; the executor claims it later.
	if forwardedStatus != entity.JobStatusPending {
		t.Errorf("forwarded whatsmeow job status = %q, want %q", forwardedStatus, entity.JobStatusPending)
	}

	// The consumer must leave the jobs row claimed: no Complete, RetryLater,
	// or Fail touched it, so it has no terminal status and no error.
	var status string
	var lastError *string
	var completedAt *time.Time
	if err := pool.QueryRow(ctx, `
		select status, last_error, completed_at from jobs where serial = $1`, serial,
	).Scan(&status, &lastError, &completedAt); err != nil {
		t.Fatalf("query jobs row after dispatch: %v", err)
	}
	if status != entity.JobStatusClaimed {
		t.Errorf("jobs status after dispatch = %q, want %q", status, entity.JobStatusClaimed)
	}
	if lastError != nil {
		t.Errorf("jobs last_error after dispatch = %q, want null", *lastError)
	}
	if completedAt != nil {
		t.Errorf("jobs completed_at after dispatch = %v, want null", *completedAt)
	}

	// The consumer stops cleanly on cancellation.
	cancel()
	select {
	case err := <-consumerErr:
		if err != nil {
			t.Errorf("consumer.Run() = %v, want nil on cancel", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("consumer did not exit after cancel")
	}
}

// TestSplitWriteBackContractRealDB drives the executor-side DB write-back
// paths through the real stores with the same calls WhatsAppExecutor makes:
// claim the whatsmeow_jobs row, then Complete/Fail both that row and the
// originating jobs row (keyed by source_job_serial).
func TestSplitWriteBackContractRealDB(t *testing.T) {
	jobsStore, whatsmeowStore, pool, prefix := splitSetup(t)
	ctx := context.Background()
	const wamid = "wamid-integration"

	t.Run("success write-back", func(t *testing.T) {
		payload := validSendMessagePayload(t)
		serialA, err := jobsStore.Enqueue(ctx, entity.Job{
			Type:           entity.JobTypeSendMessage,
			PhoneNumberID:  "phone-split-writeback",
			Payload:        payload,
			IDempotencyKey: prefix + "writeback-a",
		})
		if err != nil {
			t.Fatalf("jobsStore.Enqueue(A) error = %v", err)
		}

		// Mirror the dispatcher: a copy of the job carrying the original serial.
		serialB, err := whatsmeowStore.Enqueue(ctx, entity.Job{
			Type:            entity.JobTypeSendMessage,
			PhoneNumberID:   "phone-split-writeback",
			Payload:         payload,
			IDempotencyKey:  prefix + "writeback-a",
			SourceJobSerial: serialA,
		})
		if err != nil {
			t.Fatalf("whatsmeowStore.Enqueue(B) error = %v", err)
		}

		jobB := claimAndFind(t, ctx, whatsmeowStore, serialB)
		if jobB.Status != entity.JobStatusClaimed {
			t.Errorf("whatsmeow job B status = %q, want %q", jobB.Status, entity.JobStatusClaimed)
		}
		if jobB.Attempts != 1 {
			t.Errorf("whatsmeow job B attempts = %d, want 1 after claim", jobB.Attempts)
		}
		if jobB.SourceJobSerial != serialA {
			t.Errorf("whatsmeow job B source_job_serial = %q, want %q", jobB.SourceJobSerial, serialA)
		}

		// Executor success path: complete the whatsmeow_jobs row and write the
		// result back to the originating jobs row.
		if err := whatsmeowStore.Complete(ctx, serialB, entity.JobResult{WA_MESSAGE_ID: wamid}); err != nil {
			t.Fatalf("whatsmeowStore.Complete(B) error = %v", err)
		}
		if err := jobsStore.Complete(ctx, serialA, entity.JobResult{WA_MESSAGE_ID: wamid}); err != nil {
			t.Fatalf("jobsStore.Complete(A) error = %v", err)
		}

		var aStatus string
		var aResult []byte
		if err := pool.QueryRow(ctx, "select status, result from jobs where serial = $1", serialA).Scan(&aStatus, &aResult); err != nil {
			t.Fatalf("query jobs row A: %v", err)
		}
		if aStatus != entity.JobStatusSucceeded {
			t.Errorf("jobs A status = %q, want %q", aStatus, entity.JobStatusSucceeded)
		}
		var aResultMap map[string]string
		if err := json.Unmarshal(aResult, &aResultMap); err != nil {
			t.Fatalf("decode jobs A result: %v", err)
		}
		if aResultMap["wa_message_id"] != wamid {
			t.Errorf("jobs A result = %v, want wa_message_id = %s", aResultMap, wamid)
		}

		var bStatus string
		if err := pool.QueryRow(ctx, "select status from whatsmeow_jobs where serial = $1", serialB).Scan(&bStatus); err != nil {
			t.Fatalf("query whatsmeow_jobs row B: %v", err)
		}
		if bStatus != entity.JobStatusSucceeded {
			t.Errorf("whatsmeow job B status = %q, want %q", bStatus, entity.JobStatusSucceeded)
		}
	})

	t.Run("terminal failure write-back", func(t *testing.T) {
		payload := validSendMessagePayload(t)
		serialC, err := jobsStore.Enqueue(ctx, entity.Job{
			Type:           entity.JobTypeSendMessage,
			PhoneNumberID:  "phone-split-writeback",
			Payload:        payload,
			IDempotencyKey: prefix + "writeback-c",
		})
		if err != nil {
			t.Fatalf("jobsStore.Enqueue(C) error = %v", err)
		}

		serialD, err := whatsmeowStore.Enqueue(ctx, entity.Job{
			Type:            entity.JobTypeSendMessage,
			PhoneNumberID:   "phone-split-writeback",
			Payload:         payload,
			IDempotencyKey:  prefix + "writeback-c",
			SourceJobSerial: serialC,
		})
		if err != nil {
			t.Fatalf("whatsmeowStore.Enqueue(D) error = %v", err)
		}

		jobD := claimAndFind(t, ctx, whatsmeowStore, serialD)
		if jobD.Status != entity.JobStatusClaimed {
			t.Errorf("whatsmeow job D status = %q, want %q", jobD.Status, entity.JobStatusClaimed)
		}

		sendErr := errors.New("send failed")
		if err := jobsStore.Fail(ctx, serialC, sendErr); err != nil {
			t.Fatalf("jobsStore.Fail(C) error = %v", err)
		}
		if err := whatsmeowStore.Fail(ctx, serialD, sendErr); err != nil {
			t.Fatalf("whatsmeowStore.Fail(D) error = %v", err)
		}

		var cStatus string
		var cLastError *string
		if err := pool.QueryRow(ctx, "select status, last_error from jobs where serial = $1", serialC).Scan(&cStatus, &cLastError); err != nil {
			t.Fatalf("query jobs row C: %v", err)
		}
		if cStatus != entity.JobStatusFailed {
			t.Errorf("jobs C status = %q, want %q", cStatus, entity.JobStatusFailed)
		}
		if cLastError == nil || *cLastError != "send failed" {
			t.Errorf("jobs C last_error = %v, want %q", cLastError, "send failed")
		}

		var dStatus string
		if err := pool.QueryRow(ctx, "select status from whatsmeow_jobs where serial = $1", serialD).Scan(&dStatus); err != nil {
			t.Fatalf("query whatsmeow_jobs row D: %v", err)
		}
		if dStatus != entity.JobStatusFailed {
			t.Errorf("whatsmeow job D status = %q, want %q", dStatus, entity.JobStatusFailed)
		}
	})
}

// TestSplitClaimSemanticsRealDB verifies the claim-time attempts increment the
// executor's isTerminalAttempt decision depends on: each Claim returns the
// row with attempts = prior attempts + 1 (store.go's claimSQL adds 1).
func TestSplitClaimSemanticsRealDB(t *testing.T) {
	_, whatsmeowStore, pool, prefix := splitSetup(t)
	ctx := context.Background()

	serial, err := whatsmeowStore.Enqueue(ctx, entity.Job{
		Type:           entity.JobTypeSendMessage,
		PhoneNumberID:  "phone-split-claim",
		Payload:        validSendMessagePayload(t),
		IDempotencyKey: prefix + "claim",
	})
	if err != nil {
		t.Fatalf("whatsmeowStore.Enqueue() error = %v", err)
	}

	first := claimAndFind(t, ctx, whatsmeowStore, serial)
	if first.Attempts != 1 {
		t.Errorf("first claim attempts = %d, want 1 (prior 0 + 1)", first.Attempts)
	}

	// Reset the row to pending and claim again to prove the increment is
	// per-claim, not a fixed value.
	if _, err := pool.Exec(ctx, `
		update whatsmeow_jobs
		set status = 'pending', claimed_by = null, claimed_at = null
		where serial = $1`, serial); err != nil {
		t.Fatalf("reset whatsmeow job to pending: %v", err)
	}
	second := claimAndFind(t, ctx, whatsmeowStore, serial)
	if second.Attempts != 2 {
		t.Errorf("second claim attempts = %d, want 2 (prior 1 + 1)", second.Attempts)
	}
}
