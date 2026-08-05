package queue

import (
	"context"
	"errors"
	"log"
	"testing"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
)

// fakeSessionStore records UpdateHeartbeats calls for the heartbeat tests.
type fakeSessionStore struct {
	calls [][]string
	err   error
}

func (f *fakeSessionStore) UpdateStatus(context.Context, string, string) error { return nil }
func (f *fakeSessionStore) UpdateHeartbeats(_ context.Context, ids []string) error {
	f.calls = append(f.calls, ids)
	return f.err
}
func (f *fakeSessionStore) StoreQrCode(context.Context, string, string, time.Time) error {
	return nil
}
func (f *fakeSessionStore) GetSessionID(context.Context, string) (int64, error) { return 0, nil }
func (f *fakeSessionStore) ListSessions(context.Context) ([]domain.Session, error) {
	return nil, nil
}
func (f *fakeSessionStore) GetByPhoneNumberID(context.Context, string) (*domain.Session, error) {
	return nil, nil
}

// fakeDeviceProvider returns a configurable provisioned device list.
type fakeDeviceProvider struct {
	devices []string
}

func (f *fakeDeviceProvider) ActiveDevices() []string { return f.devices }

// runHeartbeatUntil cancels the heartbeat ctx after n ticks by cancelling the
// surrounding ctx, then asserts Run returned nil.
func runHeartbeatUntil(t *testing.T, hb *Heartbeat, ticks int) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- hb.Run(ctx) }()
	time.Sleep(time.Duration(ticks)*10*time.Millisecond + 50*time.Millisecond)
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Run() error = %v, want nil", err)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("Run() did not return after ctx cancel")
	}
}

func TestHeartbeatEmptyDeviceListSkipsUpdate(t *testing.T) {
	store := &fakeSessionStore{}
	hb := NewHeartbeat(store, &fakeDeviceProvider{}, 10*time.Millisecond, log.Default())
	runHeartbeatUntil(t, hb, 2)
	if len(store.calls) != 0 {
		t.Fatalf("UpdateHeartbeats called %d times, want 0 for empty device list", len(store.calls))
	}
}

func TestHeartbeatUpdatesActiveDevices(t *testing.T) {
	store := &fakeSessionStore{}
	ids := []string{"1001", "1002"}
	hb := NewHeartbeat(store, &fakeDeviceProvider{devices: ids}, 10*time.Millisecond, log.Default())
	runHeartbeatUntil(t, hb, 2)
	if len(store.calls) == 0 {
		t.Fatal("UpdateHeartbeats not called for non-empty device list")
	}
	for _, call := range store.calls {
		if len(call) != 2 || call[0] != "1001" || call[1] != "1002" {
			t.Errorf("UpdateHeartbeats called with %v, want [1001 1002]", call)
		}
	}
}

func TestHeartbeatKeepsLoopingOnError(t *testing.T) {
	store := &fakeSessionStore{err: errors.New("boom")}
	hb := NewHeartbeat(store, &fakeDeviceProvider{devices: []string{"1001"}}, 10*time.Millisecond, log.Default())
	// Run must survive repeated update errors and return nil on cancel.
	runHeartbeatUntil(t, hb, 3)
	if len(store.calls) == 0 {
		t.Fatal("UpdateHeartbeats not called despite update errors")
	}
}

func TestHeartbeatCtxCancelReturnsNil(t *testing.T) {
	store := &fakeSessionStore{}
	hb := NewHeartbeat(store, &fakeDeviceProvider{devices: []string{"1001"}}, 10*time.Millisecond, log.Default())
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- hb.Run(ctx) }()
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Run() error = %v, want nil", err)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("Run() did not return after ctx cancel")
	}
}

func TestNewHeartbeatNilLoggerDefaults(t *testing.T) {
	hb := NewHeartbeat(&fakeSessionStore{}, &fakeDeviceProvider{}, 0, nil)
	if hb.logger == nil {
		t.Fatal("logger should default when nil")
	}
	if hb.interval != defaultHeartbeatInterval {
		t.Fatalf("interval = %v, want default %v", hb.interval, defaultHeartbeatInterval)
	}
}
