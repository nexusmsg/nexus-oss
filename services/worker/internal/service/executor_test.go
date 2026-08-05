package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
)

type fakeSenderProvider struct {
	senders map[string]ports.MessageSender
	calls   int
}

func (p *fakeSenderProvider) Sender(phoneNumberID string) (ports.MessageSender, error) {
	p.calls++
	sender, ok := p.senders[phoneNumberID]
	if !ok {
		return nil, &ports.ErrSenderNotFound{PhoneNumberID: phoneNumberID}
	}
	return sender, nil
}

type failingSender struct{}

func (s *failingSender) Send(_ context.Context, _ domain.OutboundMessage) (domain.SendResult, error) {
	return domain.SendResult{}, errors.New("device offline")
}

// fakeSessionStore is an in-memory ports.SessionStore for hermetic tests.
type fakeSessionStore struct {
	sessions map[string]*domain.Session
	statuses map[string]string
	qrCodes  map[string]string
}

func newFakeSessionStore() *fakeSessionStore {
	return &fakeSessionStore{
		sessions: map[string]*domain.Session{},
		statuses: map[string]string{},
		qrCodes:  map[string]string{},
	}
}

func (s *fakeSessionStore) UpdateStatus(_ context.Context, phoneNumberID, status string) error {
	s.statuses[phoneNumberID] = status
	return nil
}

func (s *fakeSessionStore) UpdateHeartbeats(_ context.Context, _ []string) error { return nil }

func (s *fakeSessionStore) StoreQrCode(_ context.Context, phoneNumberID, qrCode string, _ time.Time) error {
	s.qrCodes[phoneNumberID] = qrCode
	return nil
}

func (s *fakeSessionStore) GetSessionID(_ context.Context, _ string) (int64, error) { return 0, nil }

func (s *fakeSessionStore) ListSessions(_ context.Context) ([]domain.Session, error) { return nil, nil }

func (s *fakeSessionStore) GetByPhoneNumberID(_ context.Context, phoneNumberID string) (*domain.Session, error) {
	return s.sessions[phoneNumberID], nil
}

// fakeDeviceManager is an in-memory ports.DeviceManager for hermetic tests.
type fakeDeviceManager struct {
	ensureErr error
	pairErr   error
	pairQR    string
	ensured   []domain.Session
	paired    []string
	loggedOut []string
}

func (m *fakeDeviceManager) EnsureDevice(_ context.Context, session domain.Session) error {
	m.ensured = append(m.ensured, session)
	return m.ensureErr
}

func (m *fakeDeviceManager) Pair(_ context.Context, phoneNumberID string) (string, error) {
	m.paired = append(m.paired, phoneNumberID)
	return m.pairQR, m.pairErr
}

func (m *fakeDeviceManager) Logout(_ context.Context, phoneNumberID string) error {
	m.loggedOut = append(m.loggedOut, phoneNumberID)
	return nil
}

func (m *fakeDeviceManager) ConnectStored(_ context.Context) error { return nil }

func (m *fakeDeviceManager) ActiveDevices() []string { return nil }

func (m *fakeDeviceManager) Shutdown(_ context.Context) error { return nil }

// newTestExecutor builds an executor with a fake store (optionally seeded with
// a session) and a fake device manager.
func newTestExecutor(provider ports.OutboundSenderProvider, session *domain.Session, manager *fakeDeviceManager) (*JobExecutor, *fakeSessionStore, *fakeDeviceManager) {
	store := newFakeSessionStore()
	if session != nil {
		store.sessions[session.PhoneNumberID] = session
	}
	if manager == nil {
		manager = &fakeDeviceManager{}
	}
	return NewJobExecutor(provider, store, manager), store, manager
}

func validTextPayload() []byte {
	payload, err := json.Marshal(domain.OutboundMessage{
		MessagingProduct: "whatsapp",
		To:               "628123456789",
		Type:             "text",
		Text:             &domain.Text{Body: "hello"},
	})
	if err != nil {
		panic(err)
	}
	return payload
}

func TestJobExecutorReturnsWAMessageID(t *testing.T) {
	provider := &fakeSenderProvider{senders: map[string]ports.MessageSender{
		"phone-1": &recordingSender{},
	}}
	executor, _, _ := newTestExecutor(provider, &domain.Session{PhoneNumberID: "phone-1"}, nil)

	result, err := executor.Handle(context.Background(), domain.Job{
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

func TestJobExecutorRejectsUnknownPhoneNumber(t *testing.T) {
	// The session exists but no sender is registered for it.
	executor, _, _ := newTestExecutor(&fakeSenderProvider{senders: map[string]ports.MessageSender{}},
		&domain.Session{PhoneNumberID: "phone-missing"}, nil)

	_, err := executor.Handle(context.Background(), domain.Job{
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

func TestJobExecutorRejectsInvalidPayload(t *testing.T) {
	executor, _, _ := newTestExecutor(&fakeSenderProvider{senders: map[string]ports.MessageSender{
		"phone-1": &recordingSender{},
	}}, nil, nil)
	payload, err := json.Marshal(domain.OutboundMessage{
		MessagingProduct: "whatsapp",
		To:               "628123456789",
		Type:             "image",
	})
	if err != nil {
		t.Fatal(err)
	}

	_, err = executor.Handle(context.Background(), domain.Job{
		PhoneNumberID: "phone-1",
		Payload:       payload,
	})
	if err == nil {
		t.Fatal("Handle() returned nil error for invalid payload")
	}
	var validationErr *domain.ValidationError
	if !errors.As(err, &validationErr) {
		t.Errorf("error = %v, want *domain.ValidationError", err)
	}
}

func TestJobExecutorRejectsUnmarshalablePayload(t *testing.T) {
	executor, _, _ := newTestExecutor(&fakeSenderProvider{senders: map[string]ports.MessageSender{}}, nil, nil)

	_, err := executor.Handle(context.Background(), domain.Job{
		PhoneNumberID: "phone-1",
		Payload:       []byte("{not-json"),
	})
	if err == nil || !strings.Contains(err.Error(), "unmarshal job payload") {
		t.Fatalf("Handle() error = %v, want unmarshal error", err)
	}
}

func TestJobExecutorWrapsSendFailure(t *testing.T) {
	provider := &fakeSenderProvider{senders: map[string]ports.MessageSender{
		"phone-1": &failingSender{},
	}}
	executor, _, _ := newTestExecutor(provider, &domain.Session{PhoneNumberID: "phone-1"}, nil)

	_, err := executor.Handle(context.Background(), domain.Job{
		PhoneNumberID: "phone-1",
		Payload:       validTextPayload(),
	})
	if err == nil || !strings.Contains(err.Error(), "send outbound message") {
		t.Fatalf("Handle() error = %v, want wrapped send error", err)
	}
}

func TestPairingSuccess(t *testing.T) {
	session := &domain.Session{PhoneNumberID: "phone-1", Number: "628111111111"}
	manager := &fakeDeviceManager{pairQR: "qr-123"}
	executor, store, _ := newTestExecutor(nil, session, manager)

	_, err := executor.Handle(context.Background(), domain.Job{Type: domain.JobTypePairing, PhoneNumberID: "phone-1"})
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
	if store.statuses["phone-1"] != domain.SessionStatusCreated {
		t.Fatalf("final status = %q, want created", store.statuses["phone-1"])
	}
}

func TestPairingAlreadyPairedSucceedsWithoutQR(t *testing.T) {
	session := &domain.Session{PhoneNumberID: "phone-1", Number: "628111111111"}
	manager := &fakeDeviceManager{pairErr: ports.ErrAlreadyPaired}
	executor, store, _ := newTestExecutor(nil, session, manager)

	_, err := executor.Handle(context.Background(), domain.Job{Type: domain.JobTypePairing, PhoneNumberID: "phone-1"})
	if err != nil {
		t.Fatalf("Handle() error = %v, want nil for already-paired", err)
	}
	if _, ok := store.qrCodes["phone-1"]; ok {
		t.Fatal("stored a QR code for an already-paired device")
	}
	if store.statuses["phone-1"] != domain.SessionStatusCreated {
		t.Fatalf("final status = %q, want created", store.statuses["phone-1"])
	}
}

func TestPairingMissingSession(t *testing.T) {
	executor, _, _ := newTestExecutor(nil, nil, nil)

	_, err := executor.Handle(context.Background(), domain.Job{Type: domain.JobTypePairing, PhoneNumberID: "phone-1"})
	if err == nil || !strings.Contains(err.Error(), "session not found") {
		t.Fatalf("Handle() error = %v, want session not found", err)
	}
}

func TestPairingEnsureDeviceError(t *testing.T) {
	session := &domain.Session{PhoneNumberID: "phone-1", Number: "628111111111"}
	manager := &fakeDeviceManager{ensureErr: errors.New("boom")}
	executor, _, _ := newTestExecutor(nil, session, manager)

	_, err := executor.Handle(context.Background(), domain.Job{Type: domain.JobTypePairing, PhoneNumberID: "phone-1"})
	if err == nil || !strings.Contains(err.Error(), "ensure device") {
		t.Fatalf("Handle() error = %v, want wrapped ensure device error", err)
	}
}

func TestLogoutSuccess(t *testing.T) {
	session := &domain.Session{PhoneNumberID: "phone-1", Number: "628111111111"}
	manager := &fakeDeviceManager{}
	executor, store, _ := newTestExecutor(nil, session, manager)

	_, err := executor.Handle(context.Background(), domain.Job{Type: domain.JobTypeLogout, PhoneNumberID: "phone-1"})
	if err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	if len(manager.ensured) != 1 || manager.ensured[0].PhoneNumberID != "phone-1" {
		t.Fatalf("EnsureDevice calls = %+v, want session for phone-1", manager.ensured)
	}
	if len(manager.loggedOut) != 1 || manager.loggedOut[0] != "phone-1" {
		t.Fatalf("Logout calls = %v, want [phone-1]", manager.loggedOut)
	}
	if store.statuses["phone-1"] != domain.SessionStatusLoggedOut {
		t.Fatalf("final status = %q, want logged_out", store.statuses["phone-1"])
	}
}

func TestLogoutMissingSession(t *testing.T) {
	executor, _, _ := newTestExecutor(nil, nil, nil)

	_, err := executor.Handle(context.Background(), domain.Job{Type: domain.JobTypeLogout, PhoneNumberID: "phone-1"})
	if err == nil || !strings.Contains(err.Error(), "session not found") {
		t.Fatalf("Handle() error = %v, want session not found", err)
	}
}

func TestSendEnsuresDeviceBeforeSend(t *testing.T) {
	session := &domain.Session{PhoneNumberID: "phone-1", Number: "628111111111"}
	provider := &fakeSenderProvider{senders: map[string]ports.MessageSender{
		"phone-1": &recordingSender{},
	}}
	manager := &fakeDeviceManager{}
	executor, _, _ := newTestExecutor(provider, session, manager)

	result, err := executor.Handle(context.Background(), domain.Job{
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
	executor, _, _ := newTestExecutor(provider, nil, nil)

	_, err := executor.Handle(context.Background(), domain.Job{
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
