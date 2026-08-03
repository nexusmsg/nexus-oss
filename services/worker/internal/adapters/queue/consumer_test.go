package queue

import (
	"context"
	"errors"
	"log"
	"testing"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
)

type completeCall struct {
	serial string
	result domain.JobResult
}

type retryCall struct {
	serial string
	at     time.Time
	err    error
}

type failCall struct {
	serial string
	err    error
}

type fakeJobStore struct {
	claimed  []domain.Job
	complete []completeCall
	retried  []retryCall
	failed   []failCall
}

func (s *fakeJobStore) Claim(_ context.Context, _ int) ([]domain.Job, error) {
	return s.claimed, nil
}

func (s *fakeJobStore) Complete(_ context.Context, serial string, result domain.JobResult) error {
	s.complete = append(s.complete, completeCall{serial: serial, result: result})
	return nil
}

func (s *fakeJobStore) RetryLater(_ context.Context, serial string, at time.Time, err error) error {
	s.retried = append(s.retried, retryCall{serial: serial, at: at, err: err})
	return nil
}

func (s *fakeJobStore) Fail(_ context.Context, serial string, err error) error {
	s.failed = append(s.failed, failCall{serial: serial, err: err})
	return nil
}

type fakeJobHandler struct {
	result     domain.JobResult
	err        error
	handleCall int
}

func (h *fakeJobHandler) Handle(_ context.Context, _ domain.Job) (domain.JobResult, error) {
	h.handleCall++
	return h.result, h.err
}

func newTestConsumer(store *fakeJobStore, handler *fakeJobHandler) *Consumer {
	return NewConsumer(store, handler, time.Millisecond, defaultMaxAttempts, log.Default())
}

func TestProcessJobCompletesOnSuccess(t *testing.T) {
	store := &fakeJobStore{}
	handler := &fakeJobHandler{result: domain.JobResult{WA_MESSAGE_ID: "wamid-1"}}
	consumer := newTestConsumer(store, handler)

	err := consumer.processJob(context.Background(), domain.Job{
		Serial:      "serial-1",
		Type:        domain.JobTypeSendMessage,
		Attempts:    1,
		MaxAttempts: 3,
	})
	if err != nil {
		t.Fatalf("processJob() error = %v", err)
	}
	if len(store.complete) != 1 || store.complete[0].serial != "serial-1" {
		t.Fatalf("complete = %+v", store.complete)
	}
	if store.complete[0].result.WA_MESSAGE_ID != "wamid-1" {
		t.Errorf("result = %+v", store.complete[0].result)
	}
	if len(store.retried) != 0 || len(store.failed) != 0 {
		t.Errorf("retried = %+v, failed = %+v", store.retried, store.failed)
	}
}

func TestProcessJobRetriesBelowMax(t *testing.T) {
	store := &fakeJobStore{}
	handler := &fakeJobHandler{err: errors.New("transient boom")}
	consumer := newTestConsumer(store, handler)

	now := time.Now()
	err := consumer.processJob(context.Background(), domain.Job{
		Serial:      "serial-1",
		Type:        domain.JobTypeSendMessage,
		Attempts:    1,
		MaxAttempts: 3,
	})
	if err != nil {
		t.Fatalf("processJob() error = %v", err)
	}
	if len(store.retried) != 1 || store.retried[0].serial != "serial-1" {
		t.Fatalf("retried = %+v", store.retried)
	}
	wantAt := now.Add(backoffForAttempt(1))
	if store.retried[0].at.Before(wantAt.Add(-time.Second)) || store.retried[0].at.After(wantAt.Add(time.Second)) {
		t.Errorf("available_at = %v, want ~%v", store.retried[0].at, wantAt)
	}
	if store.retried[0].err == nil || store.retried[0].err.Error() != "transient boom" {
		t.Errorf("retry err = %v", store.retried[0].err)
	}
	if len(store.failed) != 0 || len(store.complete) != 0 {
		t.Errorf("failed = %+v, complete = %+v", store.failed, store.complete)
	}
}

func TestProcessJobFailsAtMaxAttempts(t *testing.T) {
	store := &fakeJobStore{}
	handler := &fakeJobHandler{err: errors.New("permanent boom")}
	consumer := newTestConsumer(store, handler)

	err := consumer.processJob(context.Background(), domain.Job{
		Serial:      "serial-1",
		Type:        domain.JobTypeSendMessage,
		Attempts:    3,
		MaxAttempts: 3,
	})
	if err != nil {
		t.Fatalf("processJob() error = %v", err)
	}
	if len(store.failed) != 1 || store.failed[0].serial != "serial-1" {
		t.Fatalf("failed = %+v", store.failed)
	}
	if store.failed[0].err == nil || store.failed[0].err.Error() != "permanent boom" {
		t.Errorf("fail err = %v", store.failed[0].err)
	}
	if len(store.retried) != 0 || len(store.complete) != 0 {
		t.Errorf("retried = %+v, complete = %+v", store.retried, store.complete)
	}
}

func TestProcessJobUsesFallbackMaxAttempts(t *testing.T) {
	handler := &fakeJobHandler{err: errors.New("boom")}
	consumer := NewConsumer(&fakeJobStore{}, handler, time.Millisecond, 3, log.Default())

	failStore := &fakeJobStore{}
	consumer.store = failStore
	err := consumer.processJob(context.Background(), domain.Job{
		Serial:      "serial-1",
		Type:        domain.JobTypeSendMessage,
		Attempts:    3,
		MaxAttempts: 0,
	})
	if err != nil {
		t.Fatalf("processJob() error = %v", err)
	}
	if len(failStore.failed) != 1 || failStore.failed[0].serial != "serial-1" {
		t.Fatalf("failed = %+v, want fail with fallback max", failStore.failed)
	}

	retryStore := &fakeJobStore{}
	consumer.store = retryStore
	err = consumer.processJob(context.Background(), domain.Job{
		Serial:      "serial-2",
		Type:        domain.JobTypeSendMessage,
		Attempts:    1,
		MaxAttempts: 0,
	})
	if err != nil {
		t.Fatalf("processJob() error = %v", err)
	}
	if len(retryStore.retried) != 1 || retryStore.retried[0].serial != "serial-2" {
		t.Fatalf("retried = %+v, want retry below fallback max", retryStore.retried)
	}
}

func TestProcessJobFailsUnknownType(t *testing.T) {
	store := &fakeJobStore{}
	handler := &fakeJobHandler{}
	consumer := newTestConsumer(store, handler)

	err := consumer.processJob(context.Background(), domain.Job{
		Serial: "serial-1",
		Type:   "some-other-type",
	})
	if err != nil {
		t.Fatalf("processJob() error = %v", err)
	}
	if len(store.failed) != 1 || store.failed[0].serial != "serial-1" {
		t.Fatalf("failed = %+v", store.failed)
	}
	if store.failed[0].err == nil || store.failed[0].err.Error() != `unknown job type "some-other-type"` {
		t.Errorf("fail err = %v", store.failed[0].err)
	}
	if handler.handleCall != 0 {
		t.Errorf("handler called %d times for unknown type", handler.handleCall)
	}
}

func TestBackoffForAttempt(t *testing.T) {
	cases := []struct {
		attempts int
		want     time.Duration
	}{
		{0, time.Second},
		{1, time.Second},
		{2, 2 * time.Second},
		{3, 4 * time.Second},
		{4, 8 * time.Second},
		{5, 16 * time.Second},
		{6, 30 * time.Second},
		{10, 30 * time.Second},
	}
	for _, tt := range cases {
		if got := backoffForAttempt(tt.attempts); got != tt.want {
			t.Errorf("backoffForAttempt(%d) = %v, want %v", tt.attempts, got, tt.want)
		}
	}
}

func TestRunReturnsNilOnCanceledContext(t *testing.T) {
	consumer := NewConsumer(&fakeJobStore{}, &fakeJobHandler{}, time.Millisecond, 3, log.Default())
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := consumer.Run(ctx); err != nil {
		t.Fatalf("Run() error = %v", err)
	}
}

func TestRunRejectsNilDependencies(t *testing.T) {
	if err := NewConsumer(nil, &fakeJobHandler{}, time.Millisecond, 3, nil).Run(context.Background()); err == nil {
		t.Fatal("Run() with nil store returned nil error")
	}
	if err := NewConsumer(&fakeJobStore{}, nil, time.Millisecond, 3, nil).Run(context.Background()); err == nil {
		t.Fatal("Run() with nil handler returned nil error")
	}
}
