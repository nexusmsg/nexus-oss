//go:build integration

package integration_test

import (
	"context"
	"errors"
	"log"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/afikrim/waba-api-unofficial/internal/adapters/queue"
	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
)

const testSessionPrefix = "itest-session-"

// TestSessionStoreIntegrationRealDB exercises ListSessions and
// GetByPhoneNumberID against a real Postgres database. It is gated by
// TEST_DATABASE_URL and skipped when unset, mirroring the queue store
// integration test.
func TestSessionStoreIntegrationRealDB(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping session store integration test")
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

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("create test pool: %v", err)
	}
	t.Cleanup(pool.Close)

	store, err := queue.NewSessionStore(pool, log.Default())
	if err != nil {
		t.Fatalf("NewSessionStore() error = %v", err)
	}

	prefix := testSessionPrefix + time.Now().Format("150405.000000000")
	t.Cleanup(func() {
		if _, err := pool.Exec(ctx, "delete from sessions where phone_number_id like $1", prefix+"%"); err != nil {
			t.Logf("cleanup: %v", err)
		}
	})

	t.Run("list returns rows newest first", func(t *testing.T) {
		clean := func() {
			if _, err := pool.Exec(ctx, "delete from sessions where phone_number_id like $1", prefix+"%"); err != nil {
				t.Fatalf("cleanup: %v", err)
			}
		}

		// Insert out of desired order, relying on created_at desc, id desc.
		clean()
		insertSession(t, ctx, pool, prefix+"oldest", "phone-old", "", "disconnected")
		time.Sleep(5 * time.Millisecond)
		insertSession(t, ctx, pool, prefix+"newest", "phone-new", "waba-1", "connected")

		sessions, err := store.ListSessions(ctx)
		if err != nil {
			t.Fatalf("ListSessions() error = %v", err)
		}
		if len(sessions) != 2 {
			t.Fatalf("ListSessions() = %+v, want 2 rows", sessions)
		}
		if sessions[0].PhoneNumberID != prefix+"newest" {
			t.Errorf("first session = %q, want newest", sessions[0].PhoneNumberID)
		}
		if sessions[1].PhoneNumberID != prefix+"oldest" {
			t.Errorf("second session = %q, want oldest", sessions[1].PhoneNumberID)
		}
		if sessions[0].BusinessAccountID != "waba-1" {
			t.Errorf("business_account_id = %q, want waba-1", sessions[0].BusinessAccountID)
		}
	})

	t.Run("list excludes soft-deleted", func(t *testing.T) {
		clean := func() {
			if _, err := pool.Exec(ctx, "delete from sessions where phone_number_id like $1", prefix+"%"); err != nil {
				t.Fatalf("cleanup: %v", err)
			}
		}

		clean()
		insertSession(t, ctx, pool, prefix+"keep", "phone-keep", "", "connected")
		insertSession(t, ctx, pool, prefix+"deleted", "phone-del", "", "logged_out")
		if _, err := pool.Exec(ctx, `
			update sessions set deleted_at = now()
			where phone_number_id = $1`, prefix+"deleted"); err != nil {
			t.Fatalf("soft-delete session: %v", err)
		}

		sessions, err := store.ListSessions(ctx)
		if err != nil {
			t.Fatalf("ListSessions() error = %v", err)
		}
		if len(sessions) != 1 {
			t.Fatalf("ListSessions() = %+v, want 1 row (soft-deleted excluded)", sessions)
		}
		if sessions[0].PhoneNumberID != prefix+"keep" {
			t.Errorf("session = %q, want kept session", sessions[0].PhoneNumberID)
		}
	})

	t.Run("get by phone number id", func(t *testing.T) {
		clean := func() {
			if _, err := pool.Exec(ctx, "delete from sessions where phone_number_id like $1", prefix+"%"); err != nil {
				t.Fatalf("cleanup: %v", err)
			}
		}

		clean()
		insertSession(t, ctx, pool, prefix+"lookup", "628000000001", "waba-7", "pairing")

		got, err := store.GetByPhoneNumberID(ctx, prefix+"lookup")
		if err != nil {
			t.Fatalf("GetByPhoneNumberID() error = %v", err)
		}
		if got == nil {
			t.Fatal("GetByPhoneNumberID() = nil, want session")
		}
		if got.Number != "628000000001" || got.BusinessAccountID != "waba-7" || got.Status != entity.SessionStatusPairing {
			t.Errorf("GetByPhoneNumberID() = %+v", got)
		}
	})

	t.Run("get by phone number id returns nil when absent", func(t *testing.T) {
		got, err := store.GetByPhoneNumberID(ctx, prefix+"does-not-exist")
		if err != nil {
			t.Fatalf("GetByPhoneNumberID() error = %v", err)
		}
		if got != nil {
			t.Fatalf("GetByPhoneNumberID() = %+v, want nil", got)
		}
	})

	t.Run("get by phone number id returns nil when soft-deleted", func(t *testing.T) {
		clean := func() {
			if _, err := pool.Exec(ctx, "delete from sessions where phone_number_id like $1", prefix+"%"); err != nil {
				t.Fatalf("cleanup: %v", err)
			}
		}

		clean()
		insertSession(t, ctx, pool, prefix+"gone", "628000000002", "", "connected")
		if _, err := pool.Exec(ctx, `
			update sessions set deleted_at = now()
			where phone_number_id = $1`, prefix+"gone"); err != nil {
			t.Fatalf("soft-delete session: %v", err)
		}

		got, err := store.GetByPhoneNumberID(ctx, prefix+"gone")
		if err != nil {
			t.Fatalf("GetByPhoneNumberID() error = %v", err)
		}
		if got != nil {
			t.Fatalf("GetByPhoneNumberID() = %+v, want nil for soft-deleted", got)
		}
	})
	t.Run("update heartbeats refreshes last_seen_at", func(t *testing.T) {
		clean := func() {
			if _, err := pool.Exec(ctx, "delete from sessions where phone_number_id like $1", prefix+"%"); err != nil {
				t.Fatalf("cleanup: %v", err)
			}
		}

		clean()
		insertSession(t, ctx, pool, prefix+"hb-1", "628000000010", "", "connected")
		insertSession(t, ctx, pool, prefix+"hb-2", "628000000011", "", "connected")

		// Stale the sessions so a successful refresh is observable.
		if _, err := pool.Exec(ctx, `
			update sessions set last_seen_at = now() - interval '1 hour'
			where phone_number_id like $1`, prefix+"hb-%"); err != nil {
			t.Fatalf("stale sessions: %v", err)
		}

		err := store.UpdateHeartbeats(ctx, []string{prefix + "hb-1", prefix + "hb-2", prefix + "missing"})
		if err != nil {
			t.Fatalf("UpdateHeartbeats() error = %v", err)
		}

		var recent1, recent2 bool
		if err := pool.QueryRow(ctx, `
			select last_seen_at > now() - interval '1 minute'
			from sessions where phone_number_id = $1`, prefix+"hb-1").Scan(&recent1); err != nil {
			t.Fatalf("read hb-1: %v", err)
		}
		if err := pool.QueryRow(ctx, `
			select last_seen_at > now() - interval '1 minute'
			from sessions where phone_number_id = $1`, prefix+"hb-2").Scan(&recent2); err != nil {
			t.Fatalf("read hb-2: %v", err)
		}
		if !recent1 || !recent2 {
			t.Errorf("last_seen_at not refreshed: hb-1 recent=%v, hb-2 recent=%v", recent1, recent2)
		}
	})
	t.Run("mark connected sets status, whatsapp id and connected_at", func(t *testing.T) {
		clean := func() {
			if _, err := pool.Exec(ctx, "delete from sessions where phone_number_id like $1", prefix+"%"); err != nil {
				t.Fatalf("cleanup: %v", err)
			}
		}

		clean()
		insertSession(t, ctx, pool, prefix+"conn", "628000000020", "", "created")

		if err := store.MarkConnected(ctx, prefix+"conn", "628000000020@s.whatsapp.net"); err != nil {
			t.Fatalf("MarkConnected() error = %v", err)
		}

		var status, whatsappID string
		var connectedAt *time.Time
		if err := pool.QueryRow(ctx, `
			select status, whatsapp_id, connected_at
			from sessions where phone_number_id = $1`, prefix+"conn").Scan(&status, &whatsappID, &connectedAt); err != nil {
			t.Fatalf("read session: %v", err)
		}
		if status != entity.SessionStatusConnected {
			t.Errorf("status = %q, want connected", status)
		}
		if whatsappID != "628000000020@s.whatsapp.net" {
			t.Errorf("whatsapp_id = %q, want account JID", whatsappID)
		}
		if connectedAt == nil {
			t.Error("connected_at = nil, want set")
		}
	})

	t.Run("mark connected keeps existing whatsapp id on reconnect", func(t *testing.T) {
		clean := func() {
			if _, err := pool.Exec(ctx, "delete from sessions where phone_number_id like $1", prefix+"%"); err != nil {
				t.Fatalf("cleanup: %v", err)
			}
		}

		clean()
		insertSession(t, ctx, pool, prefix+"reconn", "628000000021", "", "created")
		if _, err := pool.Exec(ctx, `
			update sessions set whatsapp_id = '628000000021@s.whatsapp.net'
			where phone_number_id = $1`, prefix+"reconn"); err != nil {
			t.Fatalf("pre-set whatsapp_id: %v", err)
		}

		if err := store.MarkConnected(ctx, prefix+"reconn", ""); err != nil {
			t.Fatalf("MarkConnected() error = %v", err)
		}

		var whatsappID string
		if err := pool.QueryRow(ctx, `
			select whatsapp_id from sessions where phone_number_id = $1`, prefix+"reconn").Scan(&whatsappID); err != nil {
			t.Fatalf("read session: %v", err)
		}
		if whatsappID != "628000000021@s.whatsapp.net" {
			t.Errorf("whatsapp_id = %q, want preserved on empty reconnect", whatsappID)
		}
	})
}

func insertSession(t *testing.T, ctx context.Context, pool *pgxpool.Pool, phoneNumberID, number, businessAccountID, status string) {
	t.Helper()
	if number == "" {
		number = phoneNumberID
	}
	_, err := pool.Exec(ctx, `
		insert into sessions (phone_number_id, number, business_account_id, status)
		values ($1, $2, $3, $4)`,
		phoneNumberID, number, businessAccountID, status)
	if err != nil {
		t.Fatalf("insert session %q: %v", phoneNumberID, err)
	}
}
