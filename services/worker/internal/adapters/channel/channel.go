// Package channel implements a named-route dispatcher backed by per-route
// bounded queues and worker goroutines. It is the worker's internal routing
// abstraction: producers dispatch messages to a named channel, and a
// registered handler receives them asynchronously.
//
// Routing model (HTTP-like):
//
//   - The send (producer) side is exposed through ports.ChannelDispatcher so
//     business logic depends on the abstraction, not this adapter.
//   - The receive (handler) side is concrete: handlers register by name and
//     are invoked by a per-channel worker goroutine, like HTTP handlers.
//
// Lifecycle:
//
//	r := channel.NewRouter(logger)
//	r.Handle("inbound", inboundHandler)
//	r.Handle("outbound.send", sendHandler)
//	go r.Run(ctx)        // start workers
//	r.Dispatch(ctx, "outbound.send", msg)
//	r.Shutdown(ctx)      // drain and stop
package channel

import (
	"context"
	"fmt"
	"log"
	"sync"

	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
)

// DefaultQueueSize is the bounded buffer each channel uses when none is
// configured. It caps in-flight messages per route, giving backpressure.
const DefaultQueueSize = 32

// Handler is the receive side of a Channel. The worker invokes it for every
// dispatched message. Errors are logged and do not stop the worker.
//
// No port: the receive side is concrete, like an HTTP handler.
type Handler func(ctx context.Context, message any) error

// Channel is one named route: a bounded queue plus a worker goroutine that
// drains it and calls the registered Handler.
type Channel struct {
	name    string
	queue   chan any
	handler Handler
	logger  *log.Logger

	ctx    context.Context
	cancel context.CancelFunc
	done   chan struct{}
}

// Router is a collection of named Channels. It implements
// ports.ChannelDispatcher on the send side and exposes handler registration
// on the receive side.
type Router struct {
	mu        sync.RWMutex
	channels  map[string]*Channel
	queueSize int
	logger    *log.Logger

	ctx     context.Context
	cancel  context.CancelFunc
	running bool
	// ready is closed once Run has launched all worker goroutines, so callers
	// can wait for the router to accept dispatches.
	ready chan struct{}
}

var _ ports.ChannelDispatcher = (*Router)(nil)

// NewRouter builds a Router with the default queue size.
func NewRouter(logger *log.Logger) *Router {
	return NewRouterWithSize(DefaultQueueSize, logger)
}

// NewRouterWithSize builds a Router whose channels use queueSize buffers.
func NewRouterWithSize(queueSize int, logger *log.Logger) *Router {
	if logger == nil {
		logger = log.Default()
	}
	if queueSize <= 0 {
		queueSize = DefaultQueueSize
	}
	return &Router{
		channels:  make(map[string]*Channel),
		queueSize: queueSize,
		logger:    logger,
		ready:     make(chan struct{}),
	}
}

// Handle registers a handler for the named route. It must be called before
// Run. Registering a duplicate name, an empty name, or a nil handler returns
// an error.
func (r *Router) Handle(name string, handler Handler) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.running {
		return fmt.Errorf("channel: cannot register %q after Run", name)
	}
	if name == "" {
		return fmt.Errorf("channel: route name is empty")
	}
	if handler == nil {
		return fmt.Errorf("channel: handler for %q is nil", name)
	}
	if _, ok := r.channels[name]; ok {
		return fmt.Errorf("channel: route %q already registered", name)
	}
	r.channels[name] = &Channel{
		name:    name,
		queue:   make(chan any, r.queueSize),
		handler: handler,
		logger:  r.logger,
		done:    make(chan struct{}),
	}
	return nil
}

// Run starts a worker goroutine for every registered channel. It blocks until
// ctx is canceled; Shutdown drains workers. Returns nil on cancellation.
// Calling Run twice returns an error.
func (r *Router) Run(ctx context.Context) error {
	r.mu.Lock()
	if r.running {
		r.mu.Unlock()
		return fmt.Errorf("channel: router already running")
	}
	r.ctx, r.cancel = context.WithCancel(ctx)
	r.running = true
	channels := make([]*Channel, 0, len(r.channels))
	for _, ch := range r.channels {
		channels = append(channels, ch)
	}
	r.mu.Unlock()

	for _, ch := range channels {
		ch.ctx, ch.cancel = context.WithCancel(r.ctx)
		go ch.run()
	}
	close(r.ready)
	<-r.ctx.Done()
	return nil
}

// Shutdown stops accepting new messages, drains in-flight messages through
// each worker, and returns when all channels have exited or ctx expires.
func (r *Router) Shutdown(ctx context.Context) error {
	r.mu.Lock()
	if !r.running {
		r.mu.Unlock()
		return nil
	}
	r.cancel()
	r.running = false
	channels := make([]*Channel, 0, len(r.channels))
	for _, ch := range r.channels {
		channels = append(channels, ch)
	}
	r.mu.Unlock()

	for _, ch := range channels {
		select {
		case <-ch.done:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return nil
}

// Dispatch delivers message to the named channel. It blocks until the channel
// accepts the message (bounded backpressure) or ctx is canceled. An unknown
// route or dispatch before Run / after Shutdown returns an error.
func (r *Router) Dispatch(ctx context.Context, name string, message any) error {
	r.mu.RLock()
	ch, ok := r.channels[name]
	running := r.running
	r.mu.RUnlock()
	if !ok {
		return fmt.Errorf("channel: unknown route %q", name)
	}
	if !running {
		return fmt.Errorf("channel: router not running")
	}
	select {
	case ch.queue <- message:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-ch.ctx.Done():
		return fmt.Errorf("channel: route %q shutting down", name)
	}
}

// run is the worker loop. It drains the queue and invokes the handler until
// the channel context is canceled, then drains any remaining in-flight
// messages before exiting.
func (c *Channel) run() {
	defer close(c.done)
	for {
		select {
		case msg := <-c.queue:
			c.invoke(msg)
		case <-c.ctx.Done():
			for {
				select {
				case msg := <-c.queue:
					c.invoke(msg)
				default:
					return
				}
			}
		}
	}
}

func (c *Channel) invoke(msg any) {
	if err := c.handler(c.ctx, msg); err != nil {
		c.logger.Printf("channel %s: handler: %v", c.name, err)
	}
}
