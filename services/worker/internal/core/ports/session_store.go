package ports

import (
	"context"
	"time"
)

// SessionStore persists worker-side session and QR pairing state.
type SessionStore interface {
	// UpdateStatus updates the session status by phone_number_id.
	UpdateStatus(ctx context.Context, phoneNumberID string, status string) error
	// UpdateHeartbeat updates last_seen_at for a session by phone_number_id.
	UpdateHeartbeat(ctx context.Context, phoneNumberID string) error
	// StoreQrCode stores a QR code payload tied to a session.
	StoreQrCode(ctx context.Context, phoneNumberID string, qrCode string, expiresAt time.Time) error
	// GetSessionID returns the session ID for a phone_number_id (for FK).
	GetSessionID(ctx context.Context, phoneNumberID string) (int64, error)
}
