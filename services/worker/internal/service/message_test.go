package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
)

type fakeWebhookConfigProvider struct {
	config domain.WebhookConfig
	err    error
}

func (p *fakeWebhookConfigProvider) Get(_ context.Context, _ string) (domain.WebhookConfig, error) {
	return p.config, p.err
}

const payloadLogPrefix = "inbound WABA webhook payload: "

func TestMessageInboundLogsWABAPayload(t *testing.T) {
	var output bytes.Buffer
	svc := NewMessage(log.New(&output, "", 0), &fakeWebhookConfigProvider{})

	err := svc.Inbound(context.Background(), &domain.InboundEvent{
		BusinessAccountID:  "business-123",
		DisplayPhoneNumber: "+628123456789",
		PhoneNumberID:      "phone-123",
		ProfileName:        "Alice",
		WhatsAppID:         "628123456789",
		Message: domain.MessageEvent{
			From:      "628123456789",
			ID:        "message-123",
			Timestamp: "1700000000",
			Type:      domain.MessageEventTypeText,
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

	var payload domain.WebhookPayload
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
	svc := NewMessage(log.New(&output, "", 0), &fakeWebhookConfigProvider{err: errors.New("must not be called")})

	err := svc.Inbound(context.Background(), &domain.InboundEvent{IsFromMe: true})
	if err != nil {
		t.Fatalf("Inbound() error = %v", err)
	}
	if output.Len() != 0 {
		t.Fatalf("self-sent event produced log: %q", output.String())
	}
}

func TestMessageInboundForwardsPayload(t *testing.T) {
	var receivedBody []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read request body: %v", err)
		}
		receivedBody = body
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	svc := NewMessage(log.Default(), &fakeWebhookConfigProvider{config: domain.WebhookConfig{URL: server.URL}})

	err := svc.Inbound(context.Background(), &domain.InboundEvent{
		BusinessAccountID: "business-123",
		Message: domain.MessageEvent{
			Type: domain.MessageEventTypeText,
			Text: "hello",
		},
	})
	if err != nil {
		t.Fatalf("Inbound() error = %v", err)
	}

	var payload domain.WebhookPayload
	if err := json.Unmarshal(receivedBody, &payload); err != nil {
		t.Fatalf("decode forwarded payload: %v", err)
	}
	if payload.Entry[0].ID != "business-123" {
		t.Errorf("entry ID = %q", payload.Entry[0].ID)
	}
}

func TestMessageInboundRetriesTransientForwardFailure(t *testing.T) {
	var hits atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if hits.Add(1) < webhookForwardAttempts {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	svc := NewMessage(log.Default(), &fakeWebhookConfigProvider{config: domain.WebhookConfig{URL: server.URL}})

	err := svc.Inbound(context.Background(), &domain.InboundEvent{
		Message: domain.MessageEvent{Type: domain.MessageEventTypeText, Text: "hello"},
	})
	if err != nil {
		t.Fatalf("Inbound() error = %v", err)
	}
	if hits.Load() != webhookForwardAttempts {
		t.Errorf("forward attempts = %d, want %d", hits.Load(), webhookForwardAttempts)
	}
}

func TestMessageInboundRejectsNilEvent(t *testing.T) {
	svc := NewMessage(log.Default(), nil)
	if err := svc.Inbound(context.Background(), nil); err == nil {
		t.Fatal("Inbound(nil) returned nil error")
	}
}

func TestMessageInboundSurfacesProviderError(t *testing.T) {
	svc := NewMessage(log.Default(), &fakeWebhookConfigProvider{err: errors.New("provider boom")})

	err := svc.Inbound(context.Background(), &domain.InboundEvent{
		PhoneNumberID: "phone-123",
		Message:       domain.MessageEvent{Type: domain.MessageEventTypeText, Text: "hello"},
	})
	if err == nil || !strings.Contains(err.Error(), "resolve webhook config") {
		t.Fatalf("Inbound() error = %v, want wrapped provider error", err)
	}
}

func TestMessageInboundSkipsForwardWhenNotConfigured(t *testing.T) {
	var output bytes.Buffer
	svc := NewMessage(log.New(&output, "", 0), &fakeWebhookConfigProvider{})

	err := svc.Inbound(context.Background(), &domain.InboundEvent{
		PhoneNumberID: "phone-123",
		Message:       domain.MessageEvent{Type: domain.MessageEventTypeText, Text: "hello"},
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
		event domain.MessageEvent
		check func(t *testing.T, message domain.Message)
	}{
		{
			name: "location",
			event: domain.MessageEvent{
				Type: domain.MessageEventTypeLocation,
				Location: &domain.LocationEvent{
					Latitude:  -6.2,
					Longitude: 106.8,
					Name:      "Jakarta",
				},
			},
			check: func(t *testing.T, message domain.Message) {
				if message.Location == nil || message.Location.Name != "Jakarta" {
					t.Errorf("location = %+v", message.Location)
				}
			},
		},
		{
			name: "reaction",
			event: domain.MessageEvent{
				Type: domain.MessageEventTypeReaction,
				Reaction: &domain.ReactionEvent{
					MessageID: "original-123",
					Emoji:     "👍",
				},
			},
			check: func(t *testing.T, message domain.Message) {
				if message.Reaction == nil || message.Reaction.MessageID != "original-123" {
					t.Errorf("reaction = %+v", message.Reaction)
				}
			},
		},
		{
			name: "button reply",
			event: domain.MessageEvent{
				Type: domain.MessageEventTypeInteractive,
				Interactive: &domain.InteractiveEvent{
					Type:        "button_reply",
					ButtonReply: &domain.ButtonReplyEvent{ID: "yes", Title: "Yes"},
				},
			},
			check: func(t *testing.T, message domain.Message) {
				if message.Interactive == nil || message.Interactive.ButtonReply == nil {
					t.Errorf("interactive = %+v", message.Interactive)
				}
			},
		},
		{
			name: "list reply",
			event: domain.MessageEvent{
				Type: domain.MessageEventTypeInteractive,
				Interactive: &domain.InteractiveEvent{
					Type:      "list_reply",
					ListReply: &domain.ListReplyEvent{ID: "row-1", Title: "Row 1", Description: "Details"},
				},
			},
			check: func(t *testing.T, message domain.Message) {
				if message.Interactive == nil || message.Interactive.ListReply == nil {
					t.Errorf("interactive = %+v", message.Interactive)
				}
			},
		},
		{
			name:  "unsupported",
			event: domain.MessageEvent{Type: domain.MessageEventTypeUnknown},
			check: func(t *testing.T, message domain.Message) {
				if message.Text != nil || message.Location != nil || message.Reaction != nil || message.Interactive != nil {
					t.Errorf("unsupported message has typed content: %+v", message)
				}
			},
		},
		{
			name: "system",
			event: domain.MessageEvent{
				Type: domain.MessageEventTypeSystem,
				System: &domain.SystemEvent{
					Type: domain.SystemEventTypeUserChangedNumber,
					Body: "User Alice changed from 628111111111 to 628222222222",
					WaID: "628222222222",
				},
			},
			check: func(t *testing.T, message domain.Message) {
				if message.System == nil || message.System.Type != domain.SystemEventTypeUserChangedNumber || message.System.WaID != "628222222222" {
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
		event domain.MessageEvent
		check func(t *testing.T, message domain.Message)
	}{
		{
			name: "location",
			event: domain.MessageEvent{
				Type:     domain.MessageEventTypeLocation,
				Location: &domain.LocationEvent{Latitude: 1.2, Longitude: 3.4},
			},
			check: func(t *testing.T, message domain.Message) {
				if message.Location == nil || message.Location.Latitude != 1.2 {
					t.Errorf("location = %+v", message.Location)
				}
			},
		},
		{
			name: "reaction",
			event: domain.MessageEvent{
				Type:     domain.MessageEventTypeReaction,
				Reaction: &domain.ReactionEvent{MessageID: "quoted", Emoji: "ok"},
			},
			check: func(t *testing.T, message domain.Message) {
				if message.Reaction == nil || message.Reaction.MessageID != "quoted" {
					t.Errorf("reaction = %+v", message.Reaction)
				}
			},
		},
		{
			name: "context",
			event: domain.MessageEvent{
				Type:    domain.MessageEventTypeText,
				Text:    "reply",
				Context: &domain.ContextEvent{ID: "quoted", From: "628123"},
			},
			check: func(t *testing.T, message domain.Message) {
				if message.Context == nil || message.Context.From != "628123" {
					t.Errorf("context = %+v", message.Context)
				}
			},
		},
		{
			name: "system",
			event: domain.MessageEvent{
				Type: domain.MessageEventTypeSystem,
				System: &domain.SystemEvent{
					Type: domain.SystemEventTypeUserChangedNumber,
					Body: "User Alice changed from 628111111111 to 628222222222",
					WaID: "628222222222",
				},
			},
			check: func(t *testing.T, message domain.Message) {
				if message.System == nil || message.System.Type != domain.SystemEventTypeUserChangedNumber || message.System.WaID != "628222222222" {
					t.Errorf("system = %+v", message.System)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var output bytes.Buffer
			svc := NewMessage(log.New(&output, "", 0), &fakeWebhookConfigProvider{})
			err := svc.Inbound(context.Background(), &domain.InboundEvent{Message: tt.event})
			if err != nil {
				t.Fatalf("Inbound() error = %v", err)
			}

			lines := strings.Split(strings.TrimSpace(output.String()), "\n")
			var payload domain.WebhookPayload
			if err := json.Unmarshal([]byte(strings.TrimPrefix(lines[0], payloadLogPrefix)), &payload); err != nil {
				t.Fatalf("decode logged payload: %v", err)
			}
			tt.check(t, payload.Entry[0].Changes[0].Value.Messages[0])
		})
	}
}
