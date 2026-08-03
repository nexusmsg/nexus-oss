package ports

import (
	"fmt"
)

// OutboundSenderProvider resolves the message sender for a phone number ID.
// The registry is keyed by phone_number_id, matching the routing contract of
// the outbound job queue.
type OutboundSenderProvider interface {
	Sender(phoneNumberID string) (MessageSender, error)
}

// ErrSenderNotFound is returned when no device is registered for a phone
// number ID.
type ErrSenderNotFound struct {
	PhoneNumberID string
}

func (e *ErrSenderNotFound) Error() string {
	return fmt.Sprintf("no sender for phone number id %q", e.PhoneNumberID)
}
