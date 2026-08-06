package queue

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
	"github.com/jackc/pgx/v5/pgxpool"
)

var _ ports.JobStore = (*Store)(nil)

// Store implements ports.JobStore on top of a single queue table. The table
// name is fixed at construction: one Store per table (e.g. "jobs" and
// "whatsmeow_jobs" can each have their own Store).
type Store struct {
	pool     *pgxpool.Pool
	table    string
	ownsPool bool
	logger   *log.Logger
}

// NewStore creates a Store backed by a new pgx pool connected to dsn. table
// names the queue table and is a trusted constructor constant — never derived
// from environment or user input (table names cannot be bound as query
// parameters, so they are interpolated into SQL; fixing them here keeps that
// interpolation injection-safe).
func NewStore(ctx context.Context, dsn string, table string, logger *log.Logger) (*Store, error) {
	if dsn == "" {
		return nil, fmt.Errorf("store: dsn is empty")
	}
	if logger == nil {
		logger = log.Default()
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("store: create pgx pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("store: ping database: %w", err)
	}
	return &Store{pool: pool, table: table, ownsPool: true, logger: logger}, nil
}

// NewStoreWithPool wraps an existing pgx pool shared with other adapters; the
// pool stays owned by the caller, so Close on this Store is a no-op. Used when
// one pool must back several Stores (e.g. a whatsmeow_jobs queue Store and a
// jobs write-back Store in cmd/whatsapp_worker).
func NewStoreWithPool(pool *pgxpool.Pool, table string, logger *log.Logger) *Store {
	if logger == nil {
		logger = log.Default()
	}
	return &Store{pool: pool, table: table, ownsPool: false, logger: logger}
}

// Close releases the underlying connection pool when this Store owns it.
func (s *Store) Close() {
	if s.ownsPool {
		s.pool.Close()
	}
}

// Pool returns the underlying connection pool, shared with other queue
// adapters such as the session store and heartbeat.
func (s *Store) Pool() *pgxpool.Pool {
	return s.pool
}

// claimSQL is the claim query template. The table name is a trusted
// constructor constant (never user input), so %s interpolation is safe here —
// Postgres cannot bind table names as query parameters.
const claimSQL = `
update %s
set status = 'claimed',
    attempts = attempts + 1,
    claimed_by = $1,
    claimed_at = now()
where serial in (
    select serial
    from %s
    where status = 'pending'
      and available_at <= now()
      and deleted_at is null
    order by created_at, id
    limit $2
    for update skip locked
)
returning id, serial, type, phone_number_id, payload, status, attempts,
         max_attempts, available_at, claimed_by, claimed_at, completed_at,
         last_error, result, idempotency_key`

func (s *Store) Claim(ctx context.Context, limit int) ([]domain.Job, error) {
	if limit <= 0 {
		return nil, fmt.Errorf("store: claim limit must be positive")
	}
	hostname, err := os.Hostname()
	if err != nil {
		return nil, fmt.Errorf("store: resolve hostname: %w", err)
	}
	rows, err := s.pool.Query(ctx, fmt.Sprintf(claimSQL, s.table, s.table), hostname, limit)
	if err != nil {
		return nil, fmt.Errorf("store: claim jobs: %w", err)
	}
	defer rows.Close()

	var jobs []domain.Job
	for rows.Next() {
		var row jobRow
		if err := rows.Scan(
			&row.ID, &row.Serial, &row.Type, &row.PhoneNumberID, &row.Payload,
			&row.Status, &row.Attempts, &row.MaxAttempts, &row.AvailableAt,
			&row.ClaimedBy, &row.ClaimedAt, &row.CompletedAt, &row.LastError,
			&row.Result, &row.IDempotencyKey,
		); err != nil {
			return nil, fmt.Errorf("store: scan claimed job: %w", err)
		}
		jobs = append(jobs, row.toJob())
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: iterate claimed jobs: %w", err)
	}
	return jobs, nil
}

func (s *Store) Complete(ctx context.Context, serial string, result domain.JobResult) error {
	encoded, err := json.Marshal(result)
	if err != nil {
		return fmt.Errorf("store: marshal job result: %w", err)
	}
	tag, err := s.pool.Exec(ctx, fmt.Sprintf(`
update %s
set status = 'succeeded',
    result = $2,
    completed_at = now(),
    last_error = null,
    claimed_by = null,
    claimed_at = null
where serial = $1 and deleted_at is null`, s.table), serial, string(encoded))
	if err != nil {
		return fmt.Errorf("store: complete job %s: %w", serial, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("store: complete job %s: no matching row", serial)
	}
	return nil
}

func (s *Store) RetryLater(ctx context.Context, serial string, nextAvailableAt time.Time, lastErr error) error {
	tag, err := s.pool.Exec(ctx, fmt.Sprintf(`
update %s
set status = 'pending',
    available_at = $2,
    last_error = $3,
    claimed_by = null,
    claimed_at = null
where serial = $1 and deleted_at is null`, s.table), serial, nextAvailableAt, errMessage(lastErr))
	if err != nil {
		return fmt.Errorf("store: retry job %s: %w", serial, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("store: retry job %s: no matching row", serial)
	}
	return nil
}

func (s *Store) Fail(ctx context.Context, serial string, lastErr error) error {
	tag, err := s.pool.Exec(ctx, fmt.Sprintf(`
update %s
set status = 'failed',
    last_error = $2,
    claimed_by = null,
    claimed_at = null,
    completed_at = now()
where serial = $1 and deleted_at is null`, s.table), serial, errMessage(lastErr))
	if err != nil {
		return fmt.Errorf("store: fail job %s: %w", serial, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("store: fail job %s: no matching row", serial)
	}
	return nil
}

func errMessage(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

// jobRow is the nullable scan target for a claimed job row; the domain Job
// uses zero values for columns that are null for claimed jobs.
type jobRow struct {
	ID             int64
	Serial         string
	Type           string
	PhoneNumberID  string
	Payload        []byte
	Status         string
	Attempts       int
	MaxAttempts    int
	AvailableAt    time.Time
	ClaimedBy      *string
	ClaimedAt      *time.Time
	CompletedAt    *time.Time
	LastError      *string
	Result         *[]byte
	IDempotencyKey *string
}

func (r jobRow) toJob() domain.Job {
	return domain.Job{
		ID:             r.ID,
		Serial:         r.Serial,
		Type:           r.Type,
		PhoneNumberID:  r.PhoneNumberID,
		Payload:        r.Payload,
		Status:         r.Status,
		Attempts:       r.Attempts,
		MaxAttempts:    r.MaxAttempts,
		AvailableAt:    r.AvailableAt,
		ClaimedAt:      derefTime(r.ClaimedAt),
		CompletedAt:    derefTime(r.CompletedAt),
		ClaimedBy:      derefString(r.ClaimedBy),
		LastError:      derefString(r.LastError),
		Result:         derefBytes(r.Result),
		IDempotencyKey: derefString(r.IDempotencyKey),
	}
}

func derefTime(v *time.Time) time.Time {
	if v == nil {
		return time.Time{}
	}
	return *v
}

func derefString(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

func derefBytes(v *[]byte) []byte {
	if v == nil {
		return nil
	}
	return *v
}
