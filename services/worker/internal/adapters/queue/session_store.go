package queue

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
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

func (s *SessionStore) StoreQrCode(ctx context.Context, phoneNumberID string, qrCode string, expiresAt time.Time) error {
	sessionID, err := s.GetSessionID(ctx, phoneNumberID)
	if err != nil {
		return err
	}
	tag, err := s.pool.Exec(ctx, `
insert into session_qr_codes (session_id, phone_number_id, qr_code, status, expires_at)
values ($1, $2, $3, 'ready', $4)`, sessionID, phoneNumberID, qrCode, expiresAt)
	if err != nil {
		return fmt.Errorf("session store: store qr code for %q: %w", phoneNumberID, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("session store: store qr code for %q: no row inserted", phoneNumberID)
	}
	return nil
}

// ListSessions returns all non-deleted sessions, newest first.
func (s *SessionStore) ListSessions(ctx context.Context) ([]domain.Session, error) {
	rows, err := s.pool.Query(ctx, `
select phone_number_id, number, display_phone, business_account_id, status
from sessions
where deleted_at is null
order by created_at desc, id desc`)
	if err != nil {
		return nil, fmt.Errorf("session store: list sessions: %w", err)
	}
	defer rows.Close()

	sessions := make([]domain.Session, 0)
	for rows.Next() {
		session, err := scanSession(rows)
		if err != nil {
			return nil, fmt.Errorf("session store: scan session: %w", err)
		}
		sessions = append(sessions, session)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("session store: iterate sessions: %w", err)
	}
	return sessions, nil
}

// GetByPhoneNumberID returns the session for a phone number, or nil when absent.
func (s *SessionStore) GetByPhoneNumberID(ctx context.Context, phoneNumberID string) (*domain.Session, error) {
	session, err := scanSession(s.pool.QueryRow(ctx, `
select phone_number_id, number, display_phone, business_account_id, status
from sessions
where phone_number_id = $1 and deleted_at is null`, phoneNumberID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("session store: get session by phone number %q: %w", phoneNumberID, err)
	}
	return &session, nil
}

// rowScanner is satisfied by both *pgx.Rows and *pgx.Row, so a single scan
// helper can back both ListSessions and GetByPhoneNumberID.
type rowScanner interface {
	Scan(dest ...any) error
}

// scanSession maps a session row into domain.Session. The column order must
// match the SELECT column list used by the two queries above.
func scanSession(row rowScanner) (domain.Session, error) {
	var session domain.Session
	err := row.Scan(
		&session.PhoneNumberID,
		&session.Number,
		&session.DisplayPhone,
		&session.BusinessAccountID,
		&session.Status,
	)
	return session, err
}
