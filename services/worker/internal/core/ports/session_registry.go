package ports

import "context"

// SessionRegistry drives session lifecycle operations needed by the job
// executor for pairing and logout jobs.
type SessionRegistry interface {
	// Pair generates a QR code for the given phone number and returns it.
	Pair(ctx context.Context, phoneNumberID string) (string, error)
	// Logout disconnects and cleans up the session for the given phone number.
	Logout(ctx context.Context, phoneNumberID string) error
}
