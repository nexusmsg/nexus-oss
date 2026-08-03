package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
)

type Message struct {
	logger    *log.Logger
	forwarder ports.WebhookForwarder
}

var _ ports.MessageService = (*Message)(nil)

func NewMessage(logger *log.Logger, forwarder ports.WebhookForwarder) *Message {
	if logger == nil {
		logger = log.Default()
	}
	return &Message{logger: logger, forwarder: forwarder}
}

func (s *Message) Inbound(ctx context.Context, event *domain.InboundEvent) error {
	if event == nil {
		return fmt.Errorf("inbound event is nil")
	}
	if event.IsFromMe {
		return nil
	}

	payload := domain.WebhookPayload{
		Object: "whatsapp_business_account",
		Entry: []domain.Entry{{
			ID: event.BusinessAccountID,
			Changes: []domain.Change{{
				Field: "messages",
				Value: domain.Value{
					MessagingProduct: "whatsapp",
					Metadata: domain.Metadata{
						DisplayPhoneNumber: event.DisplayPhoneNumber,
						PhoneNumberID:      event.PhoneNumberID,
					},
					Contacts: []domain.Contact{{
						Profile: domain.Profile{Name: event.ProfileName},
						WaID:    event.WhatsAppID,
					}},
					Messages: []domain.Message{mapMessage(event.Message)},
				},
			}},
		}},
	}

	encoded, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal inbound WABA payload: %w", err)
	}
	s.logger.Printf("inbound WABA webhook payload: %s", encoded)
	if s.forwarder != nil {
		if err := s.forwarder.Forward(ctx, payload); err != nil {
			return fmt.Errorf("forward inbound WABA webhook: %w", err)
		}
	}
	return nil
}

func mapMessage(message domain.MessageEvent) domain.Message {
	result := domain.Message{
		From:      message.From,
		ID:        message.ID,
		Timestamp: message.Timestamp,
		Type:      string(message.Type),
	}

	switch message.Type {
	case domain.MessageEventTypeText:
		result.Text = &domain.Text{Body: message.Text}
	case domain.MessageEventTypeLocation:
		if message.Location != nil {
			result.Location = &domain.Location{
				Latitude:  message.Location.Latitude,
				Longitude: message.Location.Longitude,
				Name:      message.Location.Name,
				Address:   message.Location.Address,
			}
		}
	case domain.MessageEventTypeReaction:
		if message.Reaction != nil {
			result.Reaction = &domain.Reaction{
				MessageID: message.Reaction.MessageID,
				Emoji:     message.Reaction.Emoji,
			}
		}
	case domain.MessageEventTypeInteractive:
		if message.Interactive != nil {
			result.Interactive = &domain.Interactive{
				Type: message.Interactive.Type,
			}
			if message.Interactive.ButtonReply != nil {
				result.Interactive.ButtonReply = &domain.ButtonReply{
					ID:    message.Interactive.ButtonReply.ID,
					Title: message.Interactive.ButtonReply.Title,
				}
			}
			if message.Interactive.ListReply != nil {
				result.Interactive.ListReply = &domain.ListReply{
					ID:          message.Interactive.ListReply.ID,
					Title:       message.Interactive.ListReply.Title,
					Description: message.Interactive.ListReply.Description,
				}
			}
		}
	}

	if message.Context != nil {
		result.Context = &domain.MessageContext{
			ID:   message.Context.ID,
			From: message.Context.From,
		}
	}

	return result
}
