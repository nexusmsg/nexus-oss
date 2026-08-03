package service

import (
	"context"
	"testing"

	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
)

type recordingSender struct {
	message domain.OutboundMessage
}

func (s *recordingSender) Send(_ context.Context, message domain.OutboundMessage) (domain.SendResult, error) {
	s.message = message
	return domain.SendResult{ID: "wamid-123", Recipient: "628123456789"}, nil
}

func TestOutboundSendMapsTextResponse(t *testing.T) {
	sender := &recordingSender{}
	svc := NewOutbound(sender)

	response, err := svc.Send(context.Background(), domain.OutboundMessage{
		MessagingProduct: "whatsapp",
		To:               "628123456789",
		Type:             "text",
		Category:         "utility",
		Text:             &domain.Text{Body: "hello"},
	})
	if err != nil {
		t.Fatalf("Send() error = %v", err)
	}
	if sender.message.Text.Body != "hello" {
		t.Fatalf("sent text = %q", sender.message.Text.Body)
	}
	if response.MessagingProduct != "whatsapp" || response.Messages[0].ID != "wamid-123" {
		t.Fatalf("response = %+v", response)
	}
}

func TestOutboundSendRejectsInvalidRequests(t *testing.T) {
	cases := []domain.OutboundMessage{
		{MessagingProduct: "other", Type: "text", To: "6281", Text: &domain.Text{Body: "hello"}},
		{MessagingProduct: "whatsapp", Type: "image", To: "6281", Text: &domain.Text{Body: "hello"}},
		{MessagingProduct: "whatsapp", Type: "text", To: "6281"},
		{MessagingProduct: "whatsapp", Type: "text", Text: &domain.Text{Body: "hello"}},
		{MessagingProduct: "whatsapp", Type: "text", To: "6281", Category: "marketing", Text: &domain.Text{Body: "hello"}},
	}

	for _, message := range cases {
		_, err := NewOutbound(&recordingSender{}).Send(context.Background(), message)
		if err == nil {
			t.Fatalf("Send(%+v) error = %v", message, err)
		}
	}
}
