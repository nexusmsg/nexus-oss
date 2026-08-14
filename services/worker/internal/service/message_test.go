package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
)

type fakeWebhookConfigProvider struct {
	config entity.WebhookConfig
	err    error
}

func (p *fakeWebhookConfigProvider) Get(_ context.Context, _ string) (entity.WebhookConfig, error) {
	return p.config, p.err
}

// fakeWebhookForwarder records the last cfg+payload it received, counts calls,
// and returns an injected per-call error sequence (nil once exhausted).
type fakeWebhookForwarder struct {
	cfg     entity.WebhookConfig
	payload entity.WebhookPayload
	calls   int
	errs    []error
}

func (f *fakeWebhookForwarder) Forward(_ context.Context, cfg entity.WebhookConfig, payload entity.WebhookPayload) error {
	f.calls++
	f.cfg = cfg
	f.payload = payload
	if f.calls <= len(f.errs) {
		return f.errs[f.calls-1]
	}
	return nil
}

// recordingSleeper records the durations it was asked to sleep and returns
// immediately, keeping the retry path hermetic (no real clock waits).
type recordingSleeper struct {
	durations []time.Duration
}

func (r *recordingSleeper) Sleep(_ context.Context, d time.Duration) error {
	r.durations = append(r.durations, d)
	return nil
}

// ctxBlockingSleeper blocks until the context is canceled, then surfaces the
// cancellation — the injected-sleeper contract the retry path must honor.
type ctxBlockingSleeper struct {
	entered chan struct{}
}

func (b *ctxBlockingSleeper) Sleep(ctx context.Context, _ time.Duration) error {
	b.entered <- struct{}{}
	<-ctx.Done()
	return ctx.Err()
}

const payloadLogPrefix = "inbound WABA webhook payload: "

func TestMessageInboundLogsWABAPayload(t *testing.T) {
	var output bytes.Buffer
	svc := NewMessage(log.New(&output, "", 0), &fakeWebhookConfigProvider{}, nil, nil)

	err := svc.Inbound(context.Background(), &entity.InboundEvent{
		BusinessAccountID:  "business-123",
		DisplayPhoneNumber: "+628123456789",
		PhoneNumberID:      "phone-123",
		ProfileName:        "Alice",
		WhatsAppID:         "628123456789",
		Message: entity.MessageEvent{
			From:      "628123456789",
			ID:        "message-123",
			Timestamp: "1700000000",
			Type:      entity.MessageEventTypeText,
			Text:      "hello",
		},
	})
	if err != nil {
		t.Fatalf("Inbound() error = %v", err)
	}

	lines := strings.Split(strings.TrimSpace(output.String()), "\n")
	if len(lines) == 0 || !strings.HasPrefix(lines[0], payloadLogPrefix) {
		t.Fatalf("first log line = %q, want prefix %q", lines[0], payloadLogPrefix)
	}

	var payload entity.WebhookPayload
	if err := json.Unmarshal([]byte(strings.TrimPrefix(lines[0], payloadLogPrefix)), &payload); err != nil {
		t.Fatalf("decode logged payload: %v", err)
	}
	if payload.Object != "whatsapp_business_account" {
		t.Errorf("object = %q", payload.Object)
	}
	message := payload.Entry[0].Changes[0].Value.Messages[0]
	if message.From != "628123456789" || message.ID != "message-123" || message.Timestamp != "1700000000" {
		t.Errorf("base message = %+v", message)
	}
	if message.Text == nil || message.Text.Body != "hello" {
		t.Errorf("text = %+v", message.Text)
	}
}

func TestMessageInboundIgnoresSelfSentMessage(t *testing.T) {
	var output bytes.Buffer
	svc := NewMessage(log.New(&output, "", 0), &fakeWebhookConfigProvider{err: errors.New("must not be called")}, nil, nil)

	err := svc.Inbound(context.Background(), &entity.InboundEvent{IsFromMe: true})
	if err != nil {
		t.Fatalf("Inbound() error = %v", err)
	}
	if output.Len() != 0 {
		t.Fatalf("self-sent event produced log: %q", output.String())
	}
}

func TestMessageInboundForwardsPayload(t *testing.T) {
	cfg := entity.WebhookConfig{URL: "https://example.invalid/webhook", Secret: "s3cret"}
	forwarder := &fakeWebhookForwarder{}
	svc := NewMessage(log.Default(), &fakeWebhookConfigProvider{config: cfg}, forwarder, nil)

	err := svc.Inbound(context.Background(), &entity.InboundEvent{
		BusinessAccountID: "business-123",
		Message: entity.MessageEvent{
			Type: entity.MessageEventTypeText,
			Text: "hello",
		},
	})
	if err != nil {
		t.Fatalf("Inbound() error = %v", err)
	}

	if forwarder.calls != 1 {
		t.Errorf("forward calls = %d, want 1", forwarder.calls)
	}
	if forwarder.cfg != cfg {
		t.Errorf("forwarded config = %+v, want %+v", forwarder.cfg, cfg)
	}
	if forwarder.payload.Entry[0].ID != "business-123" {
		t.Errorf("entry ID = %q", forwarder.payload.Entry[0].ID)
	}
}

func TestMessageInboundRetriesTransientForwardFailure(t *testing.T) {
	forwarder := &fakeWebhookForwarder{
		errs: []error{
			errors.New("transient failure 1"),
			errors.New("transient failure 2"),
		},
	}
	sleeper := &recordingSleeper{}
	svc := NewMessage(log.Default(), &fakeWebhookConfigProvider{config: entity.WebhookConfig{URL: "https://example.invalid/webhook"}}, forwarder, nil).WithSleep(sleeper.Sleep)

	err := svc.Inbound(context.Background(), &entity.InboundEvent{
		Message: entity.MessageEvent{Type: entity.MessageEventTypeText, Text: "hello"},
	})
	if err != nil {
		t.Fatalf("Inbound() error = %v", err)
	}
	// Two transient failures then success: three forward attempts, and the
	// first two backoff sleeps in between.
	if forwarder.calls != 3 {
		t.Errorf("forward attempts = %d, want 3", forwarder.calls)
	}
	want := []time.Duration{200 * time.Millisecond, 400 * time.Millisecond}
	if !reflect.DeepEqual(sleeper.durations, want) {
		t.Errorf("sleep sequence = %v, want %v", sleeper.durations, want)
	}
}

func TestMessageInboundGivesUpAfterRetryBudget(t *testing.T) {
	forwarder := &fakeWebhookForwarder{
		errs: []error{
			errors.New("transient failure 1"),
			errors.New("transient failure 2"),
			errors.New("transient failure 3"),
			errors.New("transient failure 4"),
		},
	}
	sleeper := &recordingSleeper{}
	svc := NewMessage(log.Default(), &fakeWebhookConfigProvider{config: entity.WebhookConfig{URL: "https://example.invalid/webhook"}}, forwarder, nil).WithSleep(sleeper.Sleep)

	start := time.Now()
	err := svc.Inbound(context.Background(), &entity.InboundEvent{
		Message: entity.MessageEvent{Type: entity.MessageEventTypeText, Text: "hello"},
	})
	if err == nil {
		t.Fatal("Inbound() returned nil error after exhausting the retry budget")
	}
	if forwarder.calls != webhookForwardAttempts {
		t.Errorf("forward attempts = %d, want %d", forwarder.calls, webhookForwardAttempts)
	}
	// The full backoff schedule must be exercised before giving up.
	want := []time.Duration{200 * time.Millisecond, 400 * time.Millisecond, 800 * time.Millisecond}
	if !reflect.DeepEqual(sleeper.durations, want) {
		t.Errorf("sleep sequence = %v, want %v", sleeper.durations, want)
	}
	// The recording sleeper returns immediately, so the whole retry path must
	// finish well under the 1.4s the real backoff schedule would take.
	if elapsed := time.Since(start); elapsed >= time.Second {
		t.Errorf("retry path took %v; recording sleeper must avoid real clock waits", elapsed)
	}
}

func TestMessageInboundRetryHonorsContextCancel(t *testing.T) {
	forwarder := &fakeWebhookForwarder{errs: []error{errors.New("transient failure")}}
	sleeper := &ctxBlockingSleeper{entered: make(chan struct{})}
	svc := NewMessage(log.Default(), &fakeWebhookConfigProvider{config: entity.WebhookConfig{URL: "https://example.invalid/webhook"}}, forwarder, nil).WithSleep(sleeper.Sleep)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan error, 1)
	go func() {
		done <- svc.Inbound(ctx, &entity.InboundEvent{
			Message: entity.MessageEvent{Type: entity.MessageEventTypeText, Text: "hello"},
		})
	}()

	// The first attempt fails and the retry path enters the backoff sleep;
	// canceling the context must abort it without a real-clock wait.
	<-sleeper.entered
	cancel()

	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Errorf("Inbound() error = %v, want wrapped context.Canceled", err)
		}
		if forwarder.calls != 1 {
			t.Errorf("forward attempts = %d, want 1 (canceled before retry)", forwarder.calls)
		}
	case <-time.After(time.Second):
		t.Fatal("Inbound() did not abort after context cancel")
	}
}

func TestMessageInboundRejectsNilEvent(t *testing.T) {
	svc := NewMessage(log.Default(), nil, nil, nil)
	if err := svc.Inbound(context.Background(), nil); err == nil {
		t.Fatal("Inbound(nil) returned nil error")
	}
}

func TestMessageInboundSurfacesProviderError(t *testing.T) {
	svc := NewMessage(log.Default(), &fakeWebhookConfigProvider{err: errors.New("provider boom")}, nil, nil)

	err := svc.Inbound(context.Background(), &entity.InboundEvent{
		PhoneNumberID: "phone-123",
		Message:       entity.MessageEvent{Type: entity.MessageEventTypeText, Text: "hello"},
	})
	if err == nil || !strings.Contains(err.Error(), "resolve webhook config") {
		t.Fatalf("Inbound() error = %v, want wrapped provider error", err)
	}
}

func TestMessageInboundSkipsForwardWhenNotConfigured(t *testing.T) {
	var output bytes.Buffer
	svc := NewMessage(log.New(&output, "", 0), &fakeWebhookConfigProvider{}, nil, nil)

	err := svc.Inbound(context.Background(), &entity.InboundEvent{
		PhoneNumberID: "phone-123",
		Message:       entity.MessageEvent{Type: entity.MessageEventTypeText, Text: "hello"},
	})
	if err != nil {
		t.Fatalf("Inbound() error = %v", err)
	}
	if !strings.Contains(output.String(), "webhook not configured") {
		t.Fatalf("log = %q, want webhook-not-configured message", output.String())
	}
}

func TestMapMessageLocationReactionAndInteractive(t *testing.T) {
	tests := []struct {
		name  string
		event entity.MessageEvent
		check func(t *testing.T, message entity.Message)
	}{
		{
			name: "location",
			event: entity.MessageEvent{
				Type: entity.MessageEventTypeLocation,
				Location: &entity.LocationEvent{
					Latitude:  -6.2,
					Longitude: 106.8,
					Name:      "Jakarta",
				},
			},
			check: func(t *testing.T, message entity.Message) {
				if message.Location == nil || message.Location.Name != "Jakarta" {
					t.Errorf("location = %+v", message.Location)
				}
			},
		},
		{
			name: "reaction",
			event: entity.MessageEvent{
				Type: entity.MessageEventTypeReaction,
				Reaction: &entity.ReactionEvent{
					MessageID: "original-123",
					Emoji:     "👍",
				},
			},
			check: func(t *testing.T, message entity.Message) {
				if message.Reaction == nil || message.Reaction.MessageID != "original-123" {
					t.Errorf("reaction = %+v", message.Reaction)
				}
			},
		},
		{
			name: "button reply",
			event: entity.MessageEvent{
				Type: entity.MessageEventTypeInteractive,
				Interactive: &entity.InteractiveEvent{
					Type:        "button_reply",
					ButtonReply: &entity.ButtonReplyEvent{ID: "yes", Title: "Yes"},
				},
			},
			check: func(t *testing.T, message entity.Message) {
				if message.Interactive == nil || message.Interactive.ButtonReply == nil {
					t.Errorf("interactive = %+v", message.Interactive)
				}
			},
		},
		{
			name: "list reply",
			event: entity.MessageEvent{
				Type: entity.MessageEventTypeInteractive,
				Interactive: &entity.InteractiveEvent{
					Type:      "list_reply",
					ListReply: &entity.ListReplyEvent{ID: "row-1", Title: "Row 1", Description: "Details"},
				},
			},
			check: func(t *testing.T, message entity.Message) {
				if message.Interactive == nil || message.Interactive.ListReply == nil {
					t.Errorf("interactive = %+v", message.Interactive)
				}
			},
		},
		{
			name:  "unsupported",
			event: entity.MessageEvent{Type: entity.MessageEventTypeUnknown},
			check: func(t *testing.T, message entity.Message) {
				if message.Text != nil || message.Location != nil || message.Reaction != nil || message.Interactive != nil {
					t.Errorf("unsupported message has typed content: %+v", message)
				}
			},
		},
		{
			name: "system",
			event: entity.MessageEvent{
				Type: entity.MessageEventTypeSystem,
				System: &entity.SystemEvent{
					Type: entity.SystemEventTypeUserChangedNumber,
					Body: "User Alice changed from 628111111111 to 628222222222",
					WaID: "628222222222",
				},
			},
			check: func(t *testing.T, message entity.Message) {
				if message.System == nil || message.System.Type != entity.SystemEventTypeUserChangedNumber || message.System.WaID != "628222222222" {
					t.Errorf("system = %+v", message.System)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.check(t, mapMessage(tt.event))
		})
	}
}

func TestMessageInboundLogsTypedPayloads(t *testing.T) {
	tests := []struct {
		name  string
		event entity.MessageEvent
		check func(t *testing.T, message entity.Message)
	}{
		{
			name: "location",
			event: entity.MessageEvent{
				Type:     entity.MessageEventTypeLocation,
				Location: &entity.LocationEvent{Latitude: 1.2, Longitude: 3.4},
			},
			check: func(t *testing.T, message entity.Message) {
				if message.Location == nil || message.Location.Latitude != 1.2 {
					t.Errorf("location = %+v", message.Location)
				}
			},
		},
		{
			name: "reaction",
			event: entity.MessageEvent{
				Type:     entity.MessageEventTypeReaction,
				Reaction: &entity.ReactionEvent{MessageID: "quoted", Emoji: "ok"},
			},
			check: func(t *testing.T, message entity.Message) {
				if message.Reaction == nil || message.Reaction.MessageID != "quoted" {
					t.Errorf("reaction = %+v", message.Reaction)
				}
			},
		},
		{
			name: "context",
			event: entity.MessageEvent{
				Type:    entity.MessageEventTypeText,
				Text:    "reply",
				Context: &entity.ContextEvent{ID: "quoted", From: "628123"},
			},
			check: func(t *testing.T, message entity.Message) {
				if message.Context == nil || message.Context.From != "628123" {
					t.Errorf("context = %+v", message.Context)
				}
			},
		},
		{
			name: "system",
			event: entity.MessageEvent{
				Type: entity.MessageEventTypeSystem,
				System: &entity.SystemEvent{
					Type: entity.SystemEventTypeUserChangedNumber,
					Body: "User Alice changed from 628111111111 to 628222222222",
					WaID: "628222222222",
				},
			},
			check: func(t *testing.T, message entity.Message) {
				if message.System == nil || message.System.Type != entity.SystemEventTypeUserChangedNumber || message.System.WaID != "628222222222" {
					t.Errorf("system = %+v", message.System)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var output bytes.Buffer
			svc := NewMessage(log.New(&output, "", 0), &fakeWebhookConfigProvider{}, nil, nil)
			err := svc.Inbound(context.Background(), &entity.InboundEvent{Message: tt.event})
			if err != nil {
				t.Fatalf("Inbound() error = %v", err)
			}

			lines := strings.Split(strings.TrimSpace(output.String()), "\n")
			var payload entity.WebhookPayload
			if err := json.Unmarshal([]byte(strings.TrimPrefix(lines[0], payloadLogPrefix)), &payload); err != nil {
				t.Fatalf("decode logged payload: %v", err)
			}
			tt.check(t, payload.Entry[0].Changes[0].Value.Messages[0])
		})
	}
}
