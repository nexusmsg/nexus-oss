package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
)

type fakeSenderProvider struct {
	senders map[string]ports.MessageSender
}

func (p *fakeSenderProvider) Sender(phoneNumberID string) (ports.MessageSender, error) {
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
	executor := NewJobExecutor(provider, nil, nil)

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
	executor := NewJobExecutor(&fakeSenderProvider{senders: map[string]ports.MessageSender{}}, nil, nil)

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
	executor := NewJobExecutor(&fakeSenderProvider{senders: map[string]ports.MessageSender{
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
	executor := NewJobExecutor(&fakeSenderProvider{senders: map[string]ports.MessageSender{}}, nil, nil)

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
	executor := NewJobExecutor(provider, nil, nil)

	_, err := executor.Handle(context.Background(), domain.Job{
		PhoneNumberID: "phone-1",
		Payload:       validTextPayload(),
	})
	if err == nil || !strings.Contains(err.Error(), "send outbound message") {
		t.Fatalf("Handle() error = %v, want wrapped send error", err)
	}
}
