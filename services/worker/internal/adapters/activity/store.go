package activity

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
	"github.com/jackc/pgx/v5/pgxpool"
)

var _ ports.ActivityRecorder = (*Store)(nil)

// activityTable is the fixed table name for the store. It is a trusted
// constructor constant — never derived from environment or user input (table
// names cannot be bound as query parameters, so it is interpolated into the
// SQL; fixing it here keeps that interpolation injection-safe, matching the
// queue store convention).
const activityTable = "activity_events"

// Store implements ports.ActivityRecorder on top of the activity_events table
// (migration 000013). Activity rows are append-only; the single Record method
// returns any write error rather than swallowing it so the caller decides
// whether failure is fatal (the worker records fire-and-forget, logging and
// continuing so observability never affects the forward path — observability
// plan §10 R3).
type Store struct {
	pool   *pgxpool.Pool
	logger *log.Logger
}

// New builds a Store backed by a shared pgx pool (e.g. the queue store's pool
// in cmd/whatsapp_worker). The table name is fixed at construction. The pool is
// owned by the caller, so Close is a no-op here — never close a shared pool
// from this adapter.
func New(pool *pgxpool.Pool, logger *log.Logger) *Store {
	if logger == nil {
		logger = log.Default()
	}
	return &Store{pool: pool, logger: logger}
}

// Close is a no-op: the Store shares the pool owned by the caller.
func (s *Store) Close() {}

// Record inserts a single activity_events row from the given event. The serial
// uuid comes from event.Serial (app-generated, never the DB default — see plan
// §10 R3) and is always written. created_at defaults to now() when the event
// leaves it zero; all other columns map one-to-one from the entity. The method
// returns the write error instead of swallowing it.
func (s *Store) Record(ctx context.Context, event entity.ActivityEvent) error {
	createdAt := event.CreatedAt
	if createdAt.IsZero() {
		createdAt = time.Now()
	}
	var payload any
	if len(event.Payload) > 0 {
		payload = string(event.Payload)
	}
	_, err := s.pool.Exec(ctx, fmt.Sprintf(`
insert into %s (
    serial, type, status, phone_number_id, business_account_id, summary,
    job_serial, wa_message_id, source_activity_serial, resource_type,
    resource_serial, request_serial, payload, created_at
) values (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14
)`, activityTable),
		event.Serial,
		event.Type,
		event.Status,
		nullIfEmpty(event.PhoneNumberID),
		nullIfEmpty(event.BusinessAccountID),
		event.Summary,
		event.JobSerial,
		nullIfEmpty(event.WAMessageID),
		event.SourceActivitySerial,
		nullIfEmpty(event.ResourceType),
		event.ResourceSerial,
		nullIfEmpty(event.RequestSerial),
		payload,
		createdAt,
	)
	if err != nil {
		return fmt.Errorf("activity store: record event %s: %w", event.Serial, err)
	}
	return nil
}

// nullIfEmpty returns nil for an empty string so it binds as a SQL NULL rather
// than an empty text (the columns are nullable or have non-empty defaults).
func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
