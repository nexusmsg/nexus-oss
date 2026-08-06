package ports

import "context"

// ChannelDispatcher sends a message to a named channel. It is the producer
// (send) side of the channel router and is consumed by business logic that
// needs to dispatch messages or commands, so it is a port.
//
// The receive (handler) side is concrete and lives in
// internal/adapters/channel; it is not exposed through a port.
type ChannelDispatcher interface {
	// Dispatch delivers message to the named channel. It blocks until the
	// channel accepts the message (bounded backpressure) or ctx is canceled.
	// An unknown route or dispatch after shutdown returns an error.
	Dispatch(ctx context.Context, name string, message any) error
}
