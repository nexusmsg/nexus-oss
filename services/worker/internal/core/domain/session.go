package domain

import "time"

// Session status values mirror the sessions.status check constraint.
const (
	SessionStatusCreated      = "created"
	SessionStatusPairing      = "pairing"
	SessionStatusConnected    = "connected"
	SessionStatusDisconnected = "disconnected"
	SessionStatusLoggedOut    = "logged_out"
)

// SessionQrCode is one pairing QR payload stored for a session.
type SessionQrCode struct {
	ID            int64
	SessionID     int64
	PhoneNumberID string
	QRCode        string
	Status        string
	ExpiresAt     time.Time
}
