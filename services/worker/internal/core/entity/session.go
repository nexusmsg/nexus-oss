package entity

import "time"

// Session status values mirror the sessions.status check constraint.
const (
	SessionStatusCreated      = "created"
	SessionStatusPairing      = "pairing"
	SessionStatusConnected    = "connected"
	SessionStatusDisconnected = "disconnected"
	SessionStatusLoggedOut    = "logged_out"
)

// Session is one WhatsApp device managed by the worker, mirroring the
// sessions table. It is the provisioning input for dynamic device setup.
type Session struct {
	PhoneNumberID     string
	Number            string
	DisplayPhone      string
	BusinessAccountID string
	Status            string
}

// SessionQrCode is one pairing QR payload stored for a session.
type SessionQrCode struct {
	ID            int64
	SessionID     int64
	PhoneNumberID string
	QRCode        string
	Status        string
	ExpiresAt     time.Time
}
