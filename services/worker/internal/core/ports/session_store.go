package ports

import (
	"context"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
)

// SessionStore persists worker-side session and QR pairing state.
type SessionStore interface {
	// UpdateStatus updates the session status by phone_number_id.
	UpdateStatus(ctx context.Context, phoneNumberID string, status string) error
	// MarkConnected records a successful device connection: status connected,
	// the WhatsApp account ID when known, and connected_at.
	MarkConnected(ctx context.Context, phoneNumberID string, whatsappID string) error
	// UpdateHeartbeats refreshes last_seen_at for the given phone number IDs.
	// Missing or already-deleted sessions are tolerated.
	UpdateHeartbeats(ctx context.Context, phoneNumberIDs []string) error
	// StoreQrCode stores a QR code payload tied to a session.
	StoreQrCode(ctx context.Context, phoneNumberID string, qrCode string, expiresAt time.Time) error
	// GetSessionID returns the session ID for a phone_number_id (for FK).
	GetSessionID(ctx context.Context, phoneNumberID string) (int64, error)
	// ListSessions returns all non-deleted sessions, newest first.
	ListSessions(ctx context.Context) ([]entity.Session, error)
	// GetByPhoneNumberID returns the session for a phone number, or nil when absent.
	GetByPhoneNumberID(ctx context.Context, phoneNumberID string) (*entity.Session, error)
}
