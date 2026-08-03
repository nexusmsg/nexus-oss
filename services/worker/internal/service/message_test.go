package service

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"strings"
	"testing"

	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
)

type recordingForwarder struct {
	called  bool
	payload domain.WebhookPayload
}

func (f *recordingForwarder) Forward(_ context.Context, payload domain.WebhookPayload) error {
	f.called = true
	f.payload = payload
	return nil
}

func TestMessageInboundLogsWABAPayload(t *testing.T) {
	var output bytes.Buffer
	svc := NewMessage(log.New(&output, "", 0), nil)

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

	const prefix = "inbound WABA webhook payload: "
	line := strings.TrimSpace(output.String())
	if !strings.HasPrefix(line, prefix) {
		t.Fatalf("log = %q, want prefix %q", line, prefix)
	}

	var payload domain.WebhookPayload
	if err := json.Unmarshal([]byte(strings.TrimPrefix(line, prefix)), &payload); err != nil {
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
	svc := NewMessage(log.New(&output, "", 0), nil)

	err := svc.Inbound(context.Background(), &domain.InboundEvent{IsFromMe: true})
	if err != nil {
		t.Fatalf("Inbound() error = %v", err)
	}
	if output.Len() != 0 {
		t.Fatalf("self-sent event produced log: %q", output.String())
	}
}

func TestMessageInboundForwardsPayload(t *testing.T) {
	forwarder := &recordingForwarder{}
	svc := NewMessage(log.Default(), forwarder)

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
	if !forwarder.called {
		t.Fatal("forwarder was not called")
	}
	if forwarder.payload.Entry[0].ID != "business-123" {
		t.Errorf("entry ID = %q", forwarder.payload.Entry[0].ID)
	}
}

func TestMessageInboundRejectsNilEvent(t *testing.T) {
	svc := NewMessage(log.Default(), nil)
	if err := svc.Inbound(context.Background(), nil); err == nil {
		t.Fatal("Inbound(nil) returned nil error")
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
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var output bytes.Buffer
			svc := NewMessage(log.New(&output, "", 0), nil)
			err := svc.Inbound(context.Background(), &domain.InboundEvent{Message: tt.event})
			if err != nil {
				t.Fatalf("Inbound() error = %v", err)
			}

			line := strings.TrimSpace(output.String())
			const prefix = "inbound WABA webhook payload: "
			var payload domain.WebhookPayload
			if err := json.Unmarshal([]byte(strings.TrimPrefix(line, prefix)), &payload); err != nil {
				t.Fatalf("decode logged payload: %v", err)
			}
			tt.check(t, payload.Entry[0].Changes[0].Value.Messages[0])
		})
	}
}
