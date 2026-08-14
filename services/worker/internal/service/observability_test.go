package service

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"testing"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
	"github.com/google/uuid"
)

// newTestMessage builds a Message wired with a fake config provider, forwarder,
// sleeper, and activity recorder for observability-capture tests.
func newTestMessage(provider *fakeWebhookConfigProvider, forwarder *fakeWebhookForwarder, recorder *fakeActivityRecorder, sleeper *recordingSleeper) *Message {
	svc := NewMessage(log.Default(), provider, forwarder, recorder)
	if sleeper != nil {
		svc.WithSleep(sleeper.Sleep)
	}
	return svc
}

// sampleInbound returns a standard inbound text event carrying the
// app-generated activity serial produced at the handler choke point.
func sampleInbound(serial uuid.UUID) *entity.InboundEvent {
	return &entity.InboundEvent{
		BusinessAccountID:  "business-123",
		DisplayPhoneNumber: "+628123456789",
		PhoneNumberID:      "phone-123",
		ProfileName:        "Alice",
		WhatsAppID:         "628123456789",
		ActivitySerial:     serial,
		Message: entity.MessageEvent{
			From:      "628123456789",
			ID:        "message-123",
			Timestamp: "1700000000",
			Type:      entity.MessageEventTypeText,
			Text:      "hello",
		},
	}
}

func TestMessageInboundRecordsDeliveryRowsOKPath(t *testing.T) {
	recorder := &fakeActivityRecorder{}
	provider := &fakeWebhookConfigProvider{
		config: entity.WebhookConfig{URL: "https://example.com/hook"},
	}
	forwarder := &fakeWebhookForwarder{}
	svc := newTestMessage(provider, forwarder, recorder, nil)

	serial := uuid.New()
	err := svc.Inbound(context.Background(), sampleInbound(serial))
	if err != nil {
		t.Fatalf("Inbound() error = %v", err)
	}

	// Wait for the fire-and-forget goroutines to flush.
	waitForRecorded(t, recorder, 2)

	events := recorder.recorded()
	if len(events) != 2 {
		t.Fatalf("recorded %d events, want 2 (1 attempt + 1 terminal)", len(events))
	}

	var attempt, terminal *entity.ActivityEvent
	for i := range events {
		switch events[i].Status {
		case entity.ActivityStatusAttempted:
			attempt = &events[i]
		case entity.ActivityStatusOK:
			terminal = &events[i]
		}
	}
	if attempt == nil || terminal == nil {
		t.Fatalf("missing attempt or terminal row: attempt=%v terminal=%v", attempt, terminal)
	}
	assertDeliveryShape(t, *attempt, "attempted")
	assertDeliveryShape(t, *terminal, "ok")

	// The terminal row must link back to the inbound event serial.
	if attempt.SourceActivitySerial == nil || *attempt.SourceActivitySerial != uuid.UUID(serial) {
		t.Errorf("attempt source_activity_serial = %v, want %v", attempt.SourceActivitySerial, uuid.UUID(serial))
	}
	if terminal.SourceActivitySerial == nil || *terminal.SourceActivitySerial != uuid.UUID(serial) {
		t.Errorf("terminal source_activity_serial = %v, want %v", terminal.SourceActivitySerial, uuid.UUID(serial))
	}

	// Terminal payload must summarize the attempts and final outcome.
	var tp map[string]any
	if err := json.Unmarshal(terminal.Payload, &tp); err != nil {
		t.Fatalf("unmarshal terminal payload: %v", err)
	}
	if tp["attempts"].(float64) != 1 {
		t.Errorf("terminal attempts = %v, want 1", tp["attempts"])
	}
	if tp["final_outcome"] != "delivered" {
		t.Errorf("final_outcome = %v, want delivered", tp["final_outcome"])
	}
	if statuses, ok := tp["attempt_statuses"].([]any); !ok || len(statuses) != 1 {
		t.Errorf("attempt_statuses = %v, want len 1", tp["attempt_statuses"])
	}
}

func TestMessageInboundRecordsDeliveryRowsErrorPath(t *testing.T) {
	recorder := &fakeActivityRecorder{}
	provider := &fakeWebhookConfigProvider{
		config: entity.WebhookConfig{URL: "https://example.com/hook"},
	}
	// Forwarder fails every attempt so the retry budget is exhausted.
	forwarder := &fakeWebhookForwarder{errs: []error{errors.New("down 1"), errors.New("down 2"), errors.New("down 3"), errors.New("down 4")}}
	svc := newTestMessage(provider, forwarder, recorder, nil)

	serial := uuid.New()
	err := svc.Inbound(context.Background(), sampleInbound(serial))
	if err == nil {
		t.Fatalf("Inbound() error = nil, want forward failure")
	}

	// webhookForwardAttempts is 4: 4 attempt rows + 1 terminal error row.
	const attempts = 4
	waitForRecorded(t, recorder, attempts+1)

	events := recorder.recorded()
	if len(events) != attempts+1 {
		t.Fatalf("recorded %d events, want %d", len(events), attempts+1)
	}

	var terminal *entity.ActivityEvent
	attemptCount := 0
	for i := range events {
		switch events[i].Status {
		case entity.ActivityStatusAttempted:
			attemptCount++
			if events[i].SourceActivitySerial == nil || *events[i].SourceActivitySerial != uuid.UUID(serial) {
				t.Errorf("attempt %d source link wrong: %v", attemptCount, events[i].SourceActivitySerial)
			}
		case entity.ActivityStatusError:
			terminal = &events[i]
		}
	}
	if attemptCount != attempts {
		t.Errorf("attempt rows = %d, want %d", attemptCount, attempts)
	}
	if terminal == nil {
		t.Fatalf("missing terminal error row")
	}
	var tp map[string]any
	if err := json.Unmarshal(terminal.Payload, &tp); err != nil {
		t.Fatalf("unmarshal terminal payload: %v", err)
	}
	if tp["attempts"].(float64) != attempts {
		t.Errorf("terminal attempts = %v, want %d", tp["attempts"], attempts)
	}
	if tp["final_outcome"] == "delivered" {
		t.Errorf("final_outcome = delivered, want failure reason")
	}
	if terminal.SourceActivitySerial == nil || *terminal.SourceActivitySerial != uuid.UUID(serial) {
		t.Errorf("terminal source link = %v, want %v", terminal.SourceActivitySerial, uuid.UUID(serial))
	}
}

func TestMessageInboundRecorderFailureDoesNotFailForward(t *testing.T) {
	recorder := &fakeActivityRecorder{failAll: true}
	provider := &fakeWebhookConfigProvider{
		config: entity.WebhookConfig{URL: "https://example.com/hook"},
	}
	forwarder := &fakeWebhookForwarder{}
	svc := newTestMessage(provider, forwarder, recorder, nil)

	serial := uuid.New()
	err := svc.Inbound(context.Background(), sampleInbound(serial))
	if err != nil {
		t.Fatalf("Inbound() error = %v, recorder failure must not break the forward", err)
	}
	if forwarder.calls != 1 {
		t.Errorf("forwarder calls = %d, want 1 (forward still happened)", forwarder.calls)
	}
	// No events survive a failing-all recorder, but the forward path succeeded.
	if got := recorder.recorded(); len(got) != 0 {
		t.Errorf("recorded %d events, want 0 (all failed)", len(got))
	}
}

func TestWhatsAppExecutorRecordsSendOutcome(t *testing.T) {
	recorder := &fakeActivityRecorder{}
	provider := &fakeSenderProvider{senders: map[string]ports.MessageSender{
		"phone-1": &recordingSender{},
	}}
	executor, _, _ := newTestExecutorWithRecorder(provider, &entity.Session{PhoneNumberID: "phone-1"}, nil, &fakeJobStore{}, recorder)

	result, err := executor.Handle(context.Background(), entity.Job{
		PhoneNumberID:   "phone-1",
		SourceJobSerial: "11111111-1111-1111-1111-111111111111",
		Payload:         validTextPayload(),
	})
	if err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	if result.WA_MESSAGE_ID != "wamid-123" {
		t.Errorf("WA_MESSAGE_ID = %q, want wamid-123", result.WA_MESSAGE_ID)
	}

	waitForRecorded(t, recorder, 1)
	events := recorder.recorded()
	if len(events) != 1 {
		t.Fatalf("recorded %d events, want 1 send-outcome row", len(events))
	}
	ev := events[0]
	if ev.Type != entity.ActivityTypeWebhookDelivery {
		t.Errorf("type = %q, want webhook_delivery (mapped send outcome)", ev.Type)
	}
	if ev.Status != entity.ActivityStatusOK {
		t.Errorf("status = %q, want ok", ev.Status)
	}
	if ev.WAMessageID != "wamid-123" {
		t.Errorf("wa_message_id = %q, want wamid-123", ev.WAMessageID)
	}
	if ev.JobSerial == nil || ev.JobSerial.String() != "11111111-1111-1111-1111-111111111111" {
		t.Errorf("job_serial = %v, want source job serial", ev.JobSerial)
	}
	var p map[string]any
	if err := json.Unmarshal(ev.Payload, &p); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if p["outcome"] != "sent" {
		t.Errorf("outcome = %v, want sent", p["outcome"])
	}
	if p["to"] != "628123456789" {
		t.Errorf("to = %v, want 628123456789", p["to"])
	}
}

// --- helpers ---

// assertDeliveryShape verifies the common fields of a webhook_delivery row.
func assertDeliveryShape(t *testing.T, ev entity.ActivityEvent, status string) {
	t.Helper()
	if ev.Type != entity.ActivityTypeWebhookDelivery {
		t.Errorf("type = %q, want webhook_delivery", ev.Type)
	}
	if ev.Status != status {
		t.Errorf("status = %q, want %q", ev.Status, status)
	}
	if ev.PhoneNumberID != "phone-123" {
		t.Errorf("phone_number_id = %q, want phone-123", ev.PhoneNumberID)
	}
	var p map[string]any
	if err := json.Unmarshal(ev.Payload, &p); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if p["url"] != "https://example.com/hook" {
		t.Errorf("url = %v, want hook url", p["url"])
	}
	if p["event"] != "messages" {
		t.Errorf("event = %v, want messages", p["event"])
	}
}

// waitForRecorded polls until the recorder holds at least n events or the test
// times out — the capture goroutines are fire-and-forget, so the test must
// wait rather than assume synchronous recording.
func waitForRecorded(t *testing.T, r *fakeActivityRecorder, n int) {
	t.Helper()
	for i := 0; i < 200; i++ {
		if len(r.recorded()) >= n {
			return
		}
		time.Sleep(time.Millisecond)
	}
}

// newTestExecutorWithRecorder builds a WhatsAppExecutor wired with a recorder,
// mirroring newTestExecutor but exposing the ActivityRecorder injection point
// (and defaulting a device manager so ensureDevice succeeds).
func newTestExecutorWithRecorder(provider ports.OutboundSenderProvider, session *entity.Session, manager *fakeDeviceManager, jobStore *fakeJobStore, recorder ports.ActivityRecorder) (*WhatsAppExecutor, *fakeSessionStore, *fakeJobStore) {
	sessionStore := newFakeSessionStore()
	if session != nil {
		sessionStore.sessions[session.PhoneNumberID] = session
	}
	if manager == nil {
		manager = &fakeDeviceManager{}
	}
	var jobStorePort ports.JobStore
	if jobStore != nil {
		jobStorePort = jobStore
	}
	return NewWhatsAppExecutor(provider, sessionStore, manager, jobStorePort, recorder, log.Default()), sessionStore, jobStore
}
