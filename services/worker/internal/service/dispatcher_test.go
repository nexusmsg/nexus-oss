package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
)

func newTestDispatcher(store *fakeJobStore) *Dispatcher {
	return NewDispatcher(store, nil)
}

func TestDispatcherDispatchesValidSendMessage(t *testing.T) {
	store := &fakeJobStore{}
	dispatcher := newTestDispatcher(store)

	result, err := dispatcher.Handle(context.Background(), entity.Job{
		Serial:        "jobs-serial-1",
		Type:          entity.JobTypeSendMessage,
		PhoneNumberID: "phone-1",
		Payload:       validTextPayload(),
	})
	if !errors.Is(err, ports.ErrDispatched) {
		t.Fatalf("Handle() error = %v, want ports.ErrDispatched", err)
	}
	if result != (entity.JobResult{}) {
		t.Errorf("Handle() result = %+v, want zero value", result)
	}
	if len(store.enqueued) != 1 {
		t.Fatalf("Enqueue calls = %d, want 1", len(store.enqueued))
	}
	if store.enqueued[0].SourceJobSerial != "jobs-serial-1" {
		t.Errorf("enqueued SourceJobSerial = %q, want jobs-serial-1", store.enqueued[0].SourceJobSerial)
	}
	if store.enqueued[0].Serial != "jobs-serial-1" {
		t.Errorf("enqueued Serial = %q, want jobs-serial-1", store.enqueued[0].Serial)
	}
}

func TestDispatcherRejectsInvalidSendPayload(t *testing.T) {
	store := &fakeJobStore{}
	dispatcher := newTestDispatcher(store)
	payload, err := json.Marshal(entity.OutboundMessage{
		MessagingProduct: "whatsapp",
		To:               "628123456789",
		Type:             "image",
	})
	if err != nil {
		t.Fatal(err)
	}

	_, err = dispatcher.Handle(context.Background(), entity.Job{
		Serial:  "jobs-serial-1",
		Type:    entity.JobTypeSendMessage,
		Payload: payload,
	})
	if err == nil {
		t.Fatal("Handle() returned nil error for an invalid payload")
	}
	var validationErr *entity.ValidationError
	if !errors.As(err, &validationErr) {
		t.Errorf("error = %v, want *entity.ValidationError", err)
	}
	if len(store.enqueued) != 0 {
		t.Errorf("Enqueue called %d times, want 0 for an invalid payload", len(store.enqueued))
	}
}

func TestDispatcherRejectsUnmarshalablePayload(t *testing.T) {
	store := &fakeJobStore{}
	dispatcher := newTestDispatcher(store)

	_, err := dispatcher.Handle(context.Background(), entity.Job{
		Serial:  "jobs-serial-1",
		Type:    entity.JobTypeSendMessage,
		Payload: []byte("{not-json"),
	})
	if err == nil || !strings.Contains(err.Error(), "unmarshal job payload") {
		t.Fatalf("Handle() error = %v, want unmarshal error", err)
	}
	if len(store.enqueued) != 0 {
		t.Errorf("Enqueue called %d times, want 0 for an unmarshalable payload", len(store.enqueued))
	}
}

func TestDispatcherForwardsNonSendTypes(t *testing.T) {
	store := &fakeJobStore{}
	dispatcher := newTestDispatcher(store)

	result, err := dispatcher.Handle(context.Background(), entity.Job{
		Serial:        "jobs-serial-1",
		Type:          entity.JobTypePairing,
		PhoneNumberID: "phone-1",
	})
	if !errors.Is(err, ports.ErrDispatched) {
		t.Fatalf("Handle() error = %v, want ports.ErrDispatched", err)
	}
	if result != (entity.JobResult{}) {
		t.Errorf("Handle() result = %+v, want zero value", result)
	}
	if len(store.enqueued) != 1 {
		t.Fatalf("Enqueue calls = %d, want 1", len(store.enqueued))
	}
	if store.enqueued[0].SourceJobSerial != "jobs-serial-1" {
		t.Errorf("enqueued SourceJobSerial = %q, want jobs-serial-1", store.enqueued[0].SourceJobSerial)
	}
}

func TestDispatcherWrapsEnqueueError(t *testing.T) {
	store := &fakeJobStore{enqueueErr: errors.New("db down")}
	dispatcher := newTestDispatcher(store)

	_, err := dispatcher.Handle(context.Background(), entity.Job{
		Serial:  "jobs-serial-1",
		Type:    entity.JobTypeSendMessage,
		Payload: validTextPayload(),
	})
	if err == nil || !strings.Contains(err.Error(), "dispatch to whatsmeow_jobs") {
		t.Fatalf("Handle() error = %v, want wrapped enqueue error", err)
	}
}

func TestDispatcherRejectsNilStore(t *testing.T) {
	dispatcher := NewDispatcher(nil, nil)

	_, err := dispatcher.Handle(context.Background(), entity.Job{
		Serial:  "jobs-serial-1",
		Type:    entity.JobTypeSendMessage,
		Payload: validTextPayload(),
	})
	if err == nil || !strings.Contains(err.Error(), "dispatch store is nil") {
		t.Fatalf("Handle() error = %v, want dispatch-store-is-nil error", err)
	}
}
