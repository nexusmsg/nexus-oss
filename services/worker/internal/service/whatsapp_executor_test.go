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

func TestWhatsAppExecutorReturnsWAMessageID(t *testing.T) {
	provider := &fakeSenderProvider{senders: map[string]ports.MessageSender{
		"phone-1": &recordingSender{},
	}}
	executor, _, _ := newTestExecutor(provider, &entity.Session{PhoneNumberID: "phone-1"}, nil, &fakeJobStore{})

	result, err := executor.Handle(context.Background(), entity.Job{
		PhoneNumberID: "phone-1",
		Payload:       validTextPayload(),
	})
	if err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	if result.WA_MESSAGE_ID != "wamid-123" {
		t.Errorf("WA_MESSAGE_ID = %q, want %q", result.WA_MESSAGE_ID, "wamid-123")
	}
}

func TestWhatsAppExecutorRejectsUnknownPhoneNumber(t *testing.T) {
	// The session exists but no sender is registered for it.
	executor, _, _ := newTestExecutor(&fakeSenderProvider{senders: map[string]ports.MessageSender{}},
		&entity.Session{PhoneNumberID: "phone-missing"}, nil, &fakeJobStore{})

	_, err := executor.Handle(context.Background(), entity.Job{
		PhoneNumberID: "phone-missing",
		Payload:       validTextPayload(),
	})
	if err == nil || !strings.Contains(err.Error(), "no sender for phone number") {
		t.Fatalf("Handle() error = %v, want wrapped ErrSenderNotFound", err)
	}
	var notFound *ports.ErrSenderNotFound
	if !errors.As(err, &notFound) {
		t.Errorf("error does not wrap ErrSenderNotFound: %v", err)
	}
}

func TestWhatsAppExecutorRejectsInvalidPayload(t *testing.T) {
	executor, _, _ := newTestExecutor(&fakeSenderProvider{senders: map[string]ports.MessageSender{
		"phone-1": &recordingSender{},
	}}, nil, nil, &fakeJobStore{})
	payload, err := json.Marshal(entity.OutboundMessage{
		MessagingProduct: "whatsapp",
		To:               "628123456789",
		Type:             "image",
	})
	if err != nil {
		t.Fatal(err)
	}

	_, err = executor.Handle(context.Background(), entity.Job{
		PhoneNumberID: "phone-1",
		Payload:       payload,
	})
	if err == nil {
		t.Fatal("Handle() returned nil error for invalid payload")
	}
	var validationErr *entity.ValidationError
	if !errors.As(err, &validationErr) {
		t.Errorf("error = %v, want *entity.ValidationError", err)
	}
}

func TestWhatsAppExecutorRejectsUnmarshalablePayload(t *testing.T) {
	executor, _, _ := newTestExecutor(&fakeSenderProvider{senders: map[string]ports.MessageSender{}}, nil, nil, &fakeJobStore{})

	_, err := executor.Handle(context.Background(), entity.Job{
		PhoneNumberID: "phone-1",
		Payload:       []byte("{not-json"),
	})
	if err == nil || !strings.Contains(err.Error(), "unmarshal job payload") {
		t.Fatalf("Handle() error = %v, want unmarshal error", err)
	}
}

func TestWhatsAppExecutorWrapsSendFailure(t *testing.T) {
	provider := &fakeSenderProvider{senders: map[string]ports.MessageSender{
		"phone-1": &failingSender{},
	}}
	executor, _, _ := newTestExecutor(provider, &entity.Session{PhoneNumberID: "phone-1"}, nil, &fakeJobStore{})

	_, err := executor.Handle(context.Background(), entity.Job{
		PhoneNumberID: "phone-1",
		Payload:       validTextPayload(),
	})
	if err == nil || !strings.Contains(err.Error(), "send outbound message") {
		t.Fatalf("Handle() error = %v, want wrapped send error", err)
	}
}

func TestPairingSuccess(t *testing.T) {
	session := &entity.Session{PhoneNumberID: "phone-1", Number: "628111111111"}
	manager := &fakeDeviceManager{pairQR: "qr-123"}
	executor, store, _ := newTestExecutor(nil, session, manager, &fakeJobStore{})

	_, err := executor.Handle(context.Background(), entity.Job{Type: entity.JobTypePairing, PhoneNumberID: "phone-1"})
	if err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	if len(manager.ensured) != 1 || manager.ensured[0].PhoneNumberID != "phone-1" {
		t.Fatalf("EnsureDevice calls = %+v, want session for phone-1", manager.ensured)
	}
	if len(manager.paired) != 1 || manager.paired[0] != "phone-1" {
		t.Fatalf("Pair calls = %v, want [phone-1]", manager.paired)
	}
	if store.qrCodes["phone-1"] != "qr-123" {
		t.Fatalf("stored QR = %q, want qr-123", store.qrCodes["phone-1"])
	}
	if store.statuses["phone-1"] != entity.SessionStatusCreated {
		t.Fatalf("final status = %q, want created", store.statuses["phone-1"])
	}
}

func TestPairingAlreadyPairedSucceedsWithoutQR(t *testing.T) {
	session := &entity.Session{PhoneNumberID: "phone-1", Number: "628111111111"}
	manager := &fakeDeviceManager{pairErr: ports.ErrAlreadyPaired}
	executor, store, _ := newTestExecutor(nil, session, manager, &fakeJobStore{})

	_, err := executor.Handle(context.Background(), entity.Job{Type: entity.JobTypePairing, PhoneNumberID: "phone-1"})
	if err != nil {
		t.Fatalf("Handle() error = %v, want nil for already-paired", err)
	}
	if _, ok := store.qrCodes["phone-1"]; ok {
		t.Fatal("stored a QR code for an already-paired device")
	}
	if store.statuses["phone-1"] != entity.SessionStatusCreated {
		t.Fatalf("final status = %q, want created", store.statuses["phone-1"])
	}
}

func TestPairingMissingSession(t *testing.T) {
	executor, _, _ := newTestExecutor(nil, nil, nil, &fakeJobStore{})

	_, err := executor.Handle(context.Background(), entity.Job{Type: entity.JobTypePairing, PhoneNumberID: "phone-1"})
	if err == nil || !strings.Contains(err.Error(), "session not found") {
		t.Fatalf("Handle() error = %v, want session not found", err)
	}
}

func TestPairingEnsureDeviceError(t *testing.T) {
	session := &entity.Session{PhoneNumberID: "phone-1", Number: "628111111111"}
	manager := &fakeDeviceManager{ensureErr: errors.New("boom")}
	executor, _, _ := newTestExecutor(nil, session, manager, &fakeJobStore{})

	_, err := executor.Handle(context.Background(), entity.Job{Type: entity.JobTypePairing, PhoneNumberID: "phone-1"})
	if err == nil || !strings.Contains(err.Error(), "ensure device") {
		t.Fatalf("Handle() error = %v, want wrapped ensure device error", err)
	}
}

func TestLogoutSuccess(t *testing.T) {
	session := &entity.Session{PhoneNumberID: "phone-1", Number: "628111111111"}
	manager := &fakeDeviceManager{}
	executor, store, _ := newTestExecutor(nil, session, manager, &fakeJobStore{})

	_, err := executor.Handle(context.Background(), entity.Job{Type: entity.JobTypeLogout, PhoneNumberID: "phone-1"})
	if err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	if len(manager.ensured) != 1 || manager.ensured[0].PhoneNumberID != "phone-1" {
		t.Fatalf("EnsureDevice calls = %+v, want session for phone-1", manager.ensured)
	}
	if len(manager.loggedOut) != 1 || manager.loggedOut[0] != "phone-1" {
		t.Fatalf("Logout calls = %v, want [phone-1]", manager.loggedOut)
	}
	if store.statuses["phone-1"] != entity.SessionStatusLoggedOut {
		t.Fatalf("final status = %q, want logged_out", store.statuses["phone-1"])
	}
}

func TestLogoutMissingSession(t *testing.T) {
	executor, _, _ := newTestExecutor(nil, nil, nil, &fakeJobStore{})

	_, err := executor.Handle(context.Background(), entity.Job{Type: entity.JobTypeLogout, PhoneNumberID: "phone-1"})
	if err == nil || !strings.Contains(err.Error(), "session not found") {
		t.Fatalf("Handle() error = %v, want session not found", err)
	}
}

func TestSendEnsuresDeviceBeforeSend(t *testing.T) {
	session := &entity.Session{PhoneNumberID: "phone-1", Number: "628111111111"}
	provider := &fakeSenderProvider{senders: map[string]ports.MessageSender{
		"phone-1": &recordingSender{},
	}}
	manager := &fakeDeviceManager{}
	executor, _, _ := newTestExecutor(provider, session, manager, &fakeJobStore{})

	result, err := executor.Handle(context.Background(), entity.Job{
		PhoneNumberID: "phone-1",
		Payload:       validTextPayload(),
	})
	if err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	if len(manager.ensured) != 1 || manager.ensured[0].PhoneNumberID != "phone-1" {
		t.Fatalf("EnsureDevice calls = %+v, want session for phone-1", manager.ensured)
	}
	if result.WA_MESSAGE_ID != "wamid-123" {
		t.Fatalf("WA_MESSAGE_ID = %q, want wamid-123", result.WA_MESSAGE_ID)
	}
}

func TestSendMissingSessionDoesNotResolveSender(t *testing.T) {
	provider := &fakeSenderProvider{senders: map[string]ports.MessageSender{
		"phone-1": &recordingSender{},
	}}
	executor, _, _ := newTestExecutor(provider, nil, nil, &fakeJobStore{})

	_, err := executor.Handle(context.Background(), entity.Job{
		PhoneNumberID: "phone-1",
		Payload:       validTextPayload(),
	})
	if err == nil || !strings.Contains(err.Error(), "session not found") {
		t.Fatalf("Handle() error = %v, want session not found", err)
	}
	if provider.calls != 0 {
		t.Fatalf("Sender resolved %d times, want 0 for a missing session", provider.calls)
	}
}

// Write-back contract: on success the executor calls jobsStore.Complete with
// the originating serial and the wamid result.

func TestWhatsAppExecutorWritesBackSuccess(t *testing.T) {
	provider := &fakeSenderProvider{senders: map[string]ports.MessageSender{
		"phone-1": &recordingSender{},
	}}
	jobs := &fakeJobStore{}
	executor, _, _ := newTestExecutor(provider, &entity.Session{PhoneNumberID: "phone-1"}, nil, jobs)

	result, err := executor.Handle(context.Background(), entity.Job{
		Serial:          "whatsmeow-serial-1",
		SourceJobSerial: "jobs-serial-1",
		PhoneNumberID:   "phone-1",
		Payload:         validTextPayload(),
	})
	if err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	if len(jobs.complete) != 1 || jobs.complete[0].serial != "jobs-serial-1" {
		t.Fatalf("Complete calls = %+v, want one for jobs-serial-1", jobs.complete)
	}
	if jobs.complete[0].result.WA_MESSAGE_ID != "wamid-123" {
		t.Errorf("written back wamid = %q, want wamid-123", jobs.complete[0].result.WA_MESSAGE_ID)
	}
	if len(jobs.failed) != 0 {
		t.Errorf("Fail calls = %+v, want none", jobs.failed)
	}
	if result.WA_MESSAGE_ID != "wamid-123" {
		t.Errorf("Handle result = %+v, want wamid-123", result)
	}
}

func TestWhatsAppExecutorDoesNotPropagateWriteBackError(t *testing.T) {
	provider := &fakeSenderProvider{senders: map[string]ports.MessageSender{
		"phone-1": &recordingSender{},
	}}
	jobs := &fakeJobStore{completeErr: errors.New("write-back boom")}
	executor, _, _ := newTestExecutor(provider, &entity.Session{PhoneNumberID: "phone-1"}, nil, jobs)

	result, err := executor.Handle(context.Background(), entity.Job{
		SourceJobSerial: "jobs-serial-1",
		PhoneNumberID:   "phone-1",
		Payload:         validTextPayload(),
	})
	if err != nil {
		t.Fatalf("Handle() error = %v, want nil despite write-back failure", err)
	}
	if result.WA_MESSAGE_ID != "wamid-123" {
		t.Errorf("Handle result = %+v, want wamid-123", result)
	}
	if len(jobs.complete) != 1 {
		t.Errorf("Complete calls = %+v, want exactly one", jobs.complete)
	}
}

func TestWhatsAppExecutorWritesBackTerminalFailure(t *testing.T) {
	provider := &fakeSenderProvider{senders: map[string]ports.MessageSender{
		"phone-1": &failingSender{},
	}}
	jobs := &fakeJobStore{}
	executor, _, _ := newTestExecutor(provider, &entity.Session{PhoneNumberID: "phone-1"}, nil, jobs)

	_, err := executor.Handle(context.Background(), entity.Job{
		SourceJobSerial: "jobs-serial-1",
		PhoneNumberID:   "phone-1",
		Payload:         validTextPayload(),
		Attempts:        3,
		MaxAttempts:     3,
	})
	if err == nil || !strings.Contains(err.Error(), "send outbound message") {
		t.Fatalf("Handle() error = %v, want wrapped send error", err)
	}
	if len(jobs.failed) != 1 || jobs.failed[0].serial != "jobs-serial-1" {
		t.Fatalf("Fail calls = %+v, want one for jobs-serial-1", jobs.failed)
	}
	if len(jobs.complete) != 0 {
		t.Errorf("Complete calls = %+v, want none", jobs.complete)
	}
}

func TestWhatsAppExecutorLeavesRetryableFailureClaimed(t *testing.T) {
	provider := &fakeSenderProvider{senders: map[string]ports.MessageSender{
		"phone-1": &failingSender{},
	}}
	jobs := &fakeJobStore{}
	executor, _, _ := newTestExecutor(provider, &entity.Session{PhoneNumberID: "phone-1"}, nil, jobs)

	_, err := executor.Handle(context.Background(), entity.Job{
		SourceJobSerial: "jobs-serial-1",
		PhoneNumberID:   "phone-1",
		Payload:         validTextPayload(),
		Attempts:        1,
		MaxAttempts:     3,
	})
	if err == nil {
		t.Fatal("Handle() returned nil error for a failing sender")
	}
	if len(jobs.complete) != 0 || len(jobs.failed) != 0 {
		t.Errorf("complete = %+v, failed = %+v; want none for a retryable failure", jobs.complete, jobs.failed)
	}
}

func TestWhatsAppExecutorSkipsWriteBackWithoutSourceJobSerial(t *testing.T) {
	// Success without a source serial: no Complete.
	jobs := &fakeJobStore{}
	executor, _, _ := newTestExecutor(&fakeSenderProvider{senders: map[string]ports.MessageSender{
		"phone-1": &recordingSender{},
	}}, &entity.Session{PhoneNumberID: "phone-1"}, nil, jobs)
	if _, err := executor.Handle(context.Background(), entity.Job{PhoneNumberID: "phone-1", Payload: validTextPayload()}); err != nil {
		t.Fatalf("Handle() error = %v", err)
	}

	// Terminal failure without a source serial: no Fail.
	failJobs := &fakeJobStore{}
	failing, _, _ := newTestExecutor(&fakeSenderProvider{senders: map[string]ports.MessageSender{
		"phone-1": &failingSender{},
	}}, &entity.Session{PhoneNumberID: "phone-1"}, nil, failJobs)
	if _, err := failing.Handle(context.Background(), entity.Job{PhoneNumberID: "phone-1", Payload: validTextPayload(), Attempts: 3, MaxAttempts: 3}); err == nil {
		t.Fatal("Handle() returned nil error for a failing sender")
	}

	if len(jobs.complete) != 0 || len(jobs.failed) != 0 {
		t.Errorf("complete = %+v, failed = %+v; want no write-back without a source serial", jobs.complete, jobs.failed)
	}
	if len(failJobs.complete) != 0 || len(failJobs.failed) != 0 {
		t.Errorf("complete = %+v, failed = %+v; want no write-back without a source serial", failJobs.complete, failJobs.failed)
	}
}

func TestWhatsAppExecutorHandlesNilJobStore(t *testing.T) {
	// Success path with a nil jobs store: no panic, no write-back, result returned.
	executor, _, _ := newTestExecutor(&fakeSenderProvider{senders: map[string]ports.MessageSender{
		"phone-1": &recordingSender{},
	}}, &entity.Session{PhoneNumberID: "phone-1"}, nil, nil)
	result, err := executor.Handle(context.Background(), entity.Job{
		SourceJobSerial: "jobs-serial-1",
		PhoneNumberID:   "phone-1",
		Payload:         validTextPayload(),
	})
	if err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	if result.WA_MESSAGE_ID != "wamid-123" {
		t.Errorf("Handle result = %+v, want wamid-123", result)
	}

	// Failure path with a nil jobs store: the send error surfaces, no panic.
	failing, _, _ := newTestExecutor(&fakeSenderProvider{senders: map[string]ports.MessageSender{
		"phone-1": &failingSender{},
	}}, &entity.Session{PhoneNumberID: "phone-1"}, nil, nil)
	_, err = failing.Handle(context.Background(), entity.Job{
		SourceJobSerial: "jobs-serial-1",
		PhoneNumberID:   "phone-1",
		Payload:         validTextPayload(),
		Attempts:        3,
		MaxAttempts:     3,
	})
	if err == nil || !strings.Contains(err.Error(), "send outbound message") {
		t.Fatalf("Handle() error = %v, want wrapped send error", err)
	}
}
