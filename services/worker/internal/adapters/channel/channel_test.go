package channel

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// newStartedRouter builds a router, registers the given handlers, starts it,
// and returns the router plus a shutdown func. Fails the test on registration
// error.
func newStartedRouter(t *testing.T, handlers map[string]Handler) (*Router, func()) {
	t.Helper()
	r := NewRouter(nil)
	for name, h := range handlers {
		if err := r.Handle(name, h); err != nil {
			t.Fatalf("register %q: %v", name, err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	errCh := make(chan error, 1)
	go func() { errCh <- r.Run(ctx) }()
	<-r.ready
	shutdown := func() {
		cancel()
		_ = r.Shutdown(context.Background())
		<-errCh
	}
	return r, shutdown
}

func TestHandleRejectsEmptyName(t *testing.T) {
	r := NewRouter(nil)
	if err := r.Handle("", func(context.Context, any) error { return nil }); err == nil {
		t.Fatal("expected error for empty name")
	}
}

func TestHandleRejectsNilHandler(t *testing.T) {
	r := NewRouter(nil)
	if err := r.Handle("x", nil); err == nil {
		t.Fatal("expected error for nil handler")
	}
}

func TestHandleRejectsDuplicate(t *testing.T) {
	r := NewRouter(nil)
	h := func(context.Context, any) error { return nil }
	if err := r.Handle("dup", h); err != nil {
		t.Fatalf("first register: %v", err)
	}
	if err := r.Handle("dup", h); err == nil {
		t.Fatal("expected error for duplicate route")
	}
}

func TestHandleRejectsAfterRun(t *testing.T) {
	r := NewRouter(nil)
	if err := r.Handle("x", func(context.Context, any) error { return nil }); err != nil {
		t.Fatalf("register: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	errCh := make(chan error, 1)
	go func() { errCh <- r.Run(ctx) }()
	defer func() { cancel(); _ = r.Shutdown(context.Background()); <-errCh }()
	<-r.ready

	// The error path is what we test, so a tiny wait is acceptable here.
	time.Sleep(10 * time.Millisecond)
	if err := r.Handle("late", func(context.Context, any) error { return nil }); err == nil {
		t.Fatal("expected error registering after Run")
	}
}

func TestDispatchUnknownRoute(t *testing.T) {
	r, shutdown := newStartedRouter(t, map[string]Handler{
		"known": func(context.Context, any) error { return nil },
	})
	defer shutdown()

	if err := r.Dispatch(context.Background(), "missing", "x"); err == nil {
		t.Fatal("expected error for unknown route")
	}
}

func TestDispatchBeforeRun(t *testing.T) {
	r := NewRouter(nil)
	if err := r.Handle("x", func(context.Context, any) error { return nil }); err != nil {
		t.Fatalf("register: %v", err)
	}
	if err := r.Dispatch(context.Background(), "x", "x"); err == nil {
		t.Fatal("expected error dispatching before Run")
	}
}

func TestDispatchDeliversToHandler(t *testing.T) {
	var got atomic.Value
	done := make(chan struct{})
	h := func(_ context.Context, msg any) error {
		got.Store(msg)
		close(done)
		return nil
	}
	r, shutdown := newStartedRouter(t, map[string]Handler{"inbound": h})
	defer shutdown()

	if err := r.Dispatch(context.Background(), "inbound", "hello"); err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("handler not invoked")
	}
	if v := got.Load(); v != "hello" {
		t.Fatalf("got %v, want hello", v)
	}
}

func TestDispatchHandlerErrorIsLoggedNotFatal(t *testing.T) {
	calls := make(chan struct{}, 2)
	h := func(context.Context, any) error {
		calls <- struct{}{}
		return errors.New("boom")
	}
	r, shutdown := newStartedRouter(t, map[string]Handler{"err": h})
	defer shutdown()

	if err := r.Dispatch(context.Background(), "err", 1); err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	if err := r.Dispatch(context.Background(), "err", 2); err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	for i := 0; i < 2; i++ {
		select {
		case <-calls:
		case <-time.After(time.Second):
			t.Fatalf("handler call %d missing", i+1)
		}
	}
}

func TestDispatchCanceledContext(t *testing.T) {
	// Block the worker so the queue stays full and Dispatch can only complete
	// via ctx cancellation.
	block := make(chan struct{})
	h := func(_ context.Context, _ any) error {
		<-block
		return nil
	}
	r, shutdown := newStartedRouter(t, map[string]Handler{"blocked": h})
	defer shutdown()
	defer close(block)

	// The worker drains one message immediately and blocks on it, freeing a
	// slot. Saturate with cap+1 so the queue is full afterwards.
	for i := 0; i < DefaultQueueSize+1; i++ {
		if err := r.Dispatch(context.Background(), "blocked", i); err != nil {
			t.Fatalf("fill dispatch %d: %v", i, err)
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if err := r.Dispatch(ctx, "blocked", "overflow"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("got %v, want DeadlineExceeded", err)
	}
}

func TestBackpressureBoundedQueue(t *testing.T) {
	const size = 2
	// Block the worker so the queue fills up instead of being drained.
	block := make(chan struct{})
	r := NewRouterWithSize(size, nil)
	if err := r.Handle("q", func(_ context.Context, _ any) error {
		<-block
		return nil
	}); err != nil {
		t.Fatalf("register: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	errCh := make(chan error, 1)
	go func() { errCh <- r.Run(ctx) }()
	defer func() {
		close(block) // unblock the worker first
		cancel()
		_ = r.Shutdown(context.Background())
		<-errCh
	}()
	<-r.ready

	// The worker drains one message immediately and blocks on it, freeing a
	// slot. Saturate with cap+1 so the queue is full afterwards.
	for i := 0; i < size+1; i++ {
		if err := r.Dispatch(context.Background(), "q", i); err != nil {
			t.Fatalf("dispatch %d: %v", i, err)
		}
	}
	// Queue is full; a blocking dispatch must not succeed immediately.
	got := make(chan error, 1)
	go func() { got <- r.Dispatch(context.Background(), "q", "overflow") }()
	select {
	case err := <-got:
		t.Fatalf("dispatch should have blocked, got %v", err)
	case <-time.After(20 * time.Millisecond):
	}
}

func TestShutdownDrainsInFlight(t *testing.T) {
	var processed atomic.Int32
	h := func(_ context.Context, _ any) error {
		processed.Add(1)
		return nil
	}
	r := NewRouter(nil)
	if err := r.Handle("drain", h); err != nil {
		t.Fatalf("register: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	errCh := make(chan error, 1)
	go func() { errCh <- r.Run(ctx) }()
	<-r.ready

	// Enqueue a handful before the worker could have drained them all.
	for i := 0; i < 5; i++ {
		if err := r.Dispatch(context.Background(), "drain", i); err != nil {
			t.Fatalf("dispatch %d: %v", i, err)
		}
	}

	// Shutdown drains and waits for the worker to exit.
	if err := r.Shutdown(context.Background()); err != nil {
		t.Fatalf("shutdown: %v", err)
	}
	cancel()
	<-errCh

	if got := processed.Load(); got != 5 {
		t.Fatalf("processed %d, want 5", got)
	}
}

func TestRunTwiceRejected(t *testing.T) {
	r := NewRouter(nil)
	if err := r.Handle("x", func(context.Context, any) error { return nil }); err != nil {
		t.Fatalf("register: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	errCh := make(chan error, 1)
	go func() { errCh <- r.Run(ctx) }()
	defer func() { cancel(); _ = r.Shutdown(context.Background()); <-errCh }()
	<-r.ready

	if err := r.Run(ctx); err == nil {
		t.Fatal("expected error running twice")
	}
}

// TestConcurrentDispatch exercises Dispatch from many goroutines to flush
// data races under -race.
func TestConcurrentDispatch(t *testing.T) {
	var wg sync.WaitGroup
	h := func(_ context.Context, _ any) error {
		wg.Done()
		return nil
	}
	r, shutdown := newStartedRouter(t, map[string]Handler{"c": h})
	defer shutdown()

	const n = 100
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func(i int) {
			_ = r.Dispatch(context.Background(), "c", i)
		}(i)
	}
	wg.Wait()
}
