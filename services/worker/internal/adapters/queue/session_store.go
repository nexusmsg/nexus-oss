package queue

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/adapters/queue/dto"
	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var _ ports.SessionStore = (*SessionStore)(nil)

// SessionStore implements ports.SessionStore on the sessions and
// session_qr_codes tables, sharing the queue's connection pool.
type SessionStore struct {
	pool   *pgxpool.Pool
	logger *log.Logger
}

func NewSessionStore(pool *pgxpool.Pool, logger *log.Logger) (*SessionStore, error) {
	if pool == nil {
		return nil, errors.New("queue session store: pool is nil")
	}
	if logger == nil {
		logger = log.Default()
	}
	return &SessionStore{pool: pool, logger: logger}, nil
}

func (s *SessionStore) UpdateStatus(ctx context.Context, phoneNumberID string, status string) error {
	tag, err := s.pool.Exec(ctx, `
update sessions
set status = $2
where phone_number_id = $1 and deleted_at is null`, phoneNumberID, status)
	if err != nil {
		return fmt.Errorf("session store: update status for %q: %w", phoneNumberID, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("session store: no session for phone number %q", phoneNumberID)
	}
	return nil
}

// MarkConnected records a successful device connection: status connected, the
// WhatsApp account ID when known, and connected_at. An empty whatsappID keeps
// the existing value (e.g. on a plain reconnect).
func (s *SessionStore) MarkConnected(ctx context.Context, phoneNumberID, whatsappID string) error {
	tag, err := s.pool.Exec(ctx, `
update sessions
set status = $2,
    whatsapp_id = case when $3 <> '' then $3 else whatsapp_id end,
    connected_at = now()
where phone_number_id = $1 and deleted_at is null`, phoneNumberID, entity.SessionStatusConnected, whatsappID)
	if err != nil {
		return fmt.Errorf("session store: mark connected for %q: %w", phoneNumberID, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("session store: no session for phone number %q", phoneNumberID)
	}
	return nil
}

func (s *SessionStore) UpdateHeartbeats(ctx context.Context, phoneNumberIDs []string) error {
	if len(phoneNumberIDs) == 0 {
		return nil
	}
	_, err := s.pool.Exec(ctx, `
update sessions
set last_seen_at = now()
where phone_number_id = any($1) and deleted_at is null`, phoneNumberIDs)
	if err != nil {
		return fmt.Errorf("session store: update heartbeats: %w", err)
	}
	return nil
}

func (s *SessionStore) GetSessionID(ctx context.Context, phoneNumberID string) (int64, error) {
	var id int64
	err := s.pool.QueryRow(ctx, `
select id
from sessions
where phone_number_id = $1 and deleted_at is null`, phoneNumberID).Scan(&id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, fmt.Errorf("session store: no session for phone number %q", phoneNumberID)
		}
		return 0, fmt.Errorf("session store: get session id for %q: %w", phoneNumberID, err)
	}
	return id, nil
}

// StoreQrCode inserts a QR row tagged with the originating pairing job's
// serial and returns the new row's serial so the executor can surface it on
// the JobResult.
func (s *SessionStore) StoreQrCode(ctx context.Context, phoneNumberID string, qrCode string, expiresAt time.Time, jobSerial string) (string, error) {
	sessionID, err := s.GetSessionID(ctx, phoneNumberID)
	if err != nil {
		return "", err
	}
	var serial string
	err = s.pool.QueryRow(ctx, `
insert into session_qr_codes (session_id, phone_number_id, qr_code, status, expires_at, job_serial)
values ($1, $2, $3, 'ready', $4, $5)
returning serial`, sessionID, phoneNumberID, qrCode, expiresAt, jobSerial).Scan(&serial)
	if err != nil {
		return "", fmt.Errorf("session store: store qr code for %q: %w", phoneNumberID, err)
	}
	if serial == "" {
		return "", fmt.Errorf("session store: store qr code for %q: no row inserted", phoneNumberID)
	}
	return serial, nil
}

// ListSessions returns all non-deleted sessions, newest first.
func (s *SessionStore) ListSessions(ctx context.Context) ([]entity.Session, error) {
	rows, err := s.pool.Query(ctx, `
select phone_number_id, number, display_phone, business_account_id, status
from sessions
where deleted_at is null
order by created_at desc, id desc`)
	if err != nil {
		return nil, fmt.Errorf("session store: list sessions: %w", err)
	}
	defer rows.Close()

	sessions, err := dto.CollectSessions(rows)
	if err != nil {
		return nil, fmt.Errorf("session store: scan sessions: %w", err)
	}
	return sessions, nil
}

// GetByPhoneNumberID returns the session for a phone number, or nil when absent.
func (s *SessionStore) GetByPhoneNumberID(ctx context.Context, phoneNumberID string) (*entity.Session, error) {
	d, err := dto.ScanSession(s.pool.QueryRow(ctx, `
select phone_number_id, number, display_phone, business_account_id, status
from sessions
where phone_number_id = $1 and deleted_at is null`, phoneNumberID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("session store: get session by phone number %q: %w", phoneNumberID, err)
	}
	session := dto.ToSession(d)
	return &session, nil
}
