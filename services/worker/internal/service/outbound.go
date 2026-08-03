package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
)

type Outbound struct {
	sender ports.MessageSender
}

var _ ports.OutboundMessageService = (*Outbound)(nil)

func NewOutbound(sender ports.MessageSender) *Outbound {
	return &Outbound{sender: sender}
}

func (s *Outbound) Send(ctx context.Context, message domain.OutboundMessage) (domain.OutboundResponse, error) {
	if s.sender == nil {
		return domain.OutboundResponse{}, fmt.Errorf("message sender is nil")
	}
	if err := validateOutboundMessage(message); err != nil {
		return domain.OutboundResponse{}, err
	}

	result, err := s.sender.Send(ctx, message)
	if err != nil {
		return domain.OutboundResponse{}, fmt.Errorf("send outbound message: %w", err)
	}

	return domain.OutboundResponse{
		MessagingProduct: "whatsapp",
		Contacts: []domain.OutboundContact{{
			Input: message.To,
			WaID:  result.Recipient,
		}},
		Messages: []domain.OutboundMessageReceipt{{ID: result.ID}},
	}, nil
}

func validateOutboundMessage(message domain.OutboundMessage) error {
	if message.MessagingProduct != "whatsapp" {
		return domain.NewValidationError("messaging_product must be whatsapp")
	}
	if message.Type != "text" {
		return domain.NewValidationError(fmt.Sprintf("message type %q is not supported", message.Type))
	}
	if message.Text == nil || strings.TrimSpace(message.Text.Body) == "" {
		return domain.NewValidationError("text.body is required")
	}
	if message.To == "" {
		return domain.NewValidationError("to is required")
	}
	if message.Category != "" && message.Category != "utility" && message.Category != "authentication" && message.Category != "service" {
		return domain.NewValidationError("category must be utility, authentication, or service")
	}
	return nil
}
