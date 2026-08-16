package whatsapp

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
	"github.com/afikrim/waba-api-unofficial/internal/observability"
	"github.com/google/uuid"
	waProto "go.mau.fi/whatsmeow/binary/proto"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

// capturingMessageService records the ActivitySerial the handler passed into
// Inbound, so we can assert the same serial that produced the whatsapp_event
// row reaches the service (plan §1 G / §10 R3 serial sharing).
type capturingMessageService struct {
	capturedSerial uuid.UUID
	inboundErr     error
}

func (s *capturingMessageService) Inbound(_ context.Context, event *entity.InboundEvent) error {
	if event != nil {
		s.capturedSerial = event.ActivitySerial
	}
	return s.inboundErr
}

func TestHandlerRecordsEventRowAndSharesSerial(t *testing.T) {
	recorder := &fakeActivityRecorder{}
	svc := &capturingMessageService{}
	handler := NewHandler(svc, "business-1", "phone-1", "+628123456789", observability.NewEmitter(recorder, nil), nil)

	// A minimal *events.Message; ToInboundEvent only needs Info fields for a
	// text message translation. We pass a stub and rely on dto filling defaults.
	evt := &events.Message{
		Info: types.MessageInfo{
			ID:   "wamid-abc",
			Type: "text",
			MessageSource: types.MessageSource{
				IsFromMe: false,
				Sender:   types.NewJID("628123456789", "s.whatsapp.net"),
			},
		},
		RawMessage: &waProto.Message{},
	}

	handler.Handle(context.Background())(evt)

	// Wait for the fire-and-forget event-row write.
	waitForRecorded(t, recorder, 1)

	events := recorder.recorded()
	if len(events) != 1 {
		t.Fatalf("recorded %d events, want 1 whatsapp_event row", len(events))
	}
	ev := events[0]
	if ev.Type != entity.ActivityTypeWhatsAppEvent {
		t.Errorf("type = %q, want whatsapp_event", ev.Type)
	}
	if ev.Status != entity.ActivityStatusOK {
		t.Errorf("status = %q, want ok", ev.Status)
	}
	if ev.WAMessageID != "wamid-abc" {
		t.Errorf("wa_message_id = %q", ev.WAMessageID)
	}
	// The SAME serial must reach the service for source linking.
	if svc.capturedSerial != ev.Serial {
		t.Errorf("Inbound received serial %v, but event row serial was %v", svc.capturedSerial, ev.Serial)
	}
}

func TestHandlerNilRecorderNoEventRow(t *testing.T) {
	svc := &capturingMessageService{}
	handler := NewHandler(svc, "business-1", "phone-1", "+628123456789", nil, nil)

	evt := &events.Message{
		Info: types.MessageInfo{
			ID:   "wamid-xyz",
			Type: "text",
			MessageSource: types.MessageSource{
				IsFromMe: false,
				Sender:   types.NewJID("628123456789", "s.whatsapp.net"),
			},
		},
		RawMessage: &waProto.Message{},
	}
	handler.Handle(context.Background())(evt)

	if svc.capturedSerial == uuid.Nil {
		t.Errorf("expected a generated serial even with no recorder")
	}
}

// fakeActivityRecorder mirrors the service-package fake; duplicated here to
// keep the handler test package-isolated (whatsapp package).
type fakeActivityRecorder struct {
	mu     sync.Mutex
	events []entity.ActivityEvent
}

func (r *fakeActivityRecorder) Record(_ context.Context, event entity.ActivityEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, event)
	return nil
}

func (r *fakeActivityRecorder) recorded() []entity.ActivityEvent {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]entity.ActivityEvent, len(r.events))
	copy(out, r.events)
	return out
}

func waitForRecorded(t *testing.T, r *fakeActivityRecorder, n int) {
	t.Helper()
	for i := 0; i < 200; i++ {
		if len(r.recorded()) >= n {
			return
		}
		time.Sleep(time.Millisecond)
	}
}

var _ ports.MessageService = (*capturingMessageService)(nil)

var _ = errors.New
