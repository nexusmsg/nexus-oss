package whatsmeow

import (
	"context"
	"errors"
	"sync/atomic"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store"
)

// lifecycleCmdKind enumerates the commands a per-device actor can receive.
type lifecycleCmdKind int

const (
	cmdPair lifecycleCmdKind = iota
	cmdLogout
	cmdConnect
	cmdStop
)

// lifecycleCmd is one command routed to a device actor. Commands that need a
// result carry a response channel; the caller waits on it, never the manager
// loop.
type lifecycleCmd struct {
	kind lifecycleCmdKind
	ctx  context.Context
	resp chan lifecycleResponse
}

// lifecycleResponse is the result of a pair or logout command.
type lifecycleResponse struct {
	qr  string
	err error
}

// deviceRef is one provisioned device and its actor goroutine. The actor owns
// the connect/reconnect lifecycle; the manager only routes commands to it.
type deviceRef struct {
	client        *Client
	number        string
	phoneNumberID string

	lifecycle chan lifecycleCmd
	// onRemoved removes the device from the manager's routing maps after a
	// successful logout. Removal is the manager's job, never the actor's.
	onRemoved func(phoneNumberID string)

	pairCtx    context.Context
	pairCancel context.CancelFunc

	// connectPending is set by the Disconnected handler (cross-goroutine) and
	// consumed by the actor. It is the source of truth for a pending connect.
	connectPending atomic.Bool
	// reconnectPending is actor-owned: at most one outstanding reconnect timer.
	reconnectPending bool

	done chan struct{}
	ctx  context.Context
	// cancel stops the actor goroutine; Shutdown and logout call it directly.
	cancel context.CancelFunc
}

// newDeviceRef builds a device actor whose ctx is standalone: Shutdown and
// logout cancel it directly.
func newDeviceRef(client *Client, phoneNumberID string, onRemoved func(phoneNumberID string)) *deviceRef {
	ctx, cancel := context.WithCancel(context.Background())
	return &deviceRef{
		client:        client,
		number:        client.number,
		phoneNumberID: phoneNumberID,
		lifecycle:     make(chan lifecycleCmd, 4),
		onRemoved:     onRemoved,
		done:          make(chan struct{}),
		ctx:           ctx,
		cancel:        cancel,
	}
}

// run is the actor loop. It attempts a pending connect at loop start and after
// every command, then waits for the next lifecycle command or shutdown.
func (ref *deviceRef) run() {
	defer close(ref.done)
	for {
		ref.maybeConnect()
		select {
		case <-ref.ctx.Done():
			return
		case cmd := <-ref.lifecycle:
			switch cmd.kind {
			case cmdConnect:
				ref.tryConnect()
			case cmdPair:
				ref.pair(cmd)
			case cmdLogout:
				ref.logout(cmd)
			case cmdStop:
				ref.cancelPair()
				return
			}
		}
	}
}

// maybeConnect runs one connect attempt when a connect is pending.
func (ref *deviceRef) maybeConnect() {
	if ref.connectPending.Swap(false) {
		ref.tryConnect()
	}
}

// tryConnect attempts one connect and schedules a bounded reconnect on
// transient failures. Terminal failures stop retrying.
func (ref *deviceRef) tryConnect() {
	err := ref.client.connect(ref.ctx)
	switch {
	case err == nil:
	case errors.Is(err, ErrNotPaired),
		errors.Is(err, whatsmeow.ErrAlreadyConnected),
		errors.Is(err, store.ErrDeviceDeleted):
		// Terminal: unpaired (waits for a pairing job), already connected, or
		// the device was deleted. Do not retry.
	default:
		ref.client.logger.Printf("whatsmeow: reconnect device %s: %v", ref.number, err)
		if !ref.reconnectPending {
			ref.reconnectPending = true
			time.AfterFunc(reconnectInterval, func() {
				ref.reconnectPending = false
				select {
				case ref.lifecycle <- lifecycleCmd{kind: cmdConnect}:
				case <-ref.ctx.Done():
				}
			})
		}
	}
}

// pair runs a QR pairing flow. It returns after the first code so the actor
// blocks seconds, not minutes; the QR channel stays alive under pairCtx until
// the next pair, logout, or stop.
func (ref *deviceRef) pair(cmd lifecycleCmd) {
	ref.cancelPair()
	ref.pairCtx, ref.pairCancel = context.WithCancel(ref.ctx)
	qr, err := ref.client.Pair(ref.pairCtx)
	if cmd.resp != nil {
		cmd.resp <- lifecycleResponse{qr: qr, err: err}
	}
}

// logout disconnects the device and, on success, removes it from the
// manager's routing maps.
func (ref *deviceRef) logout(cmd lifecycleCmd) {
	ref.cancelPair()
	err := ref.client.Logout(cmd.ctx)
	if cmd.resp != nil {
		cmd.resp <- lifecycleResponse{err: err}
	}
	if err == nil {
		if ref.onRemoved != nil {
			ref.onRemoved(ref.phoneNumberID)
		}
		// Actor has been removed from the manager's routing maps; exit
		// immediately to avoid a goroutine leak (no further commands will
		// arrive on ref.lifecycle after removal).
		ref.cancel()
	}
}

// cancelPair cancels any in-flight pairing flow.
func (ref *deviceRef) cancelPair() {
	if ref.pairCancel != nil {
		ref.pairCancel()
		ref.pairCancel = nil
	}
}

// wakeup requests a connect without blocking. The connectPending flag is the
// source of truth, so a dropped wakeup is harmless.
func (ref *deviceRef) wakeup() {
	select {
	case ref.lifecycle <- lifecycleCmd{kind: cmdConnect}:
	default:
	}
}
