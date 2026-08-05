package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/adapters/webhook"
	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
)

type Message struct {
	logger   *log.Logger
	provider ports.WebhookConfigProvider
}

var _ ports.MessageService = (*Message)(nil)

func NewMessage(logger *log.Logger, provider ports.WebhookConfigProvider) *Message {
	if logger == nil {
		logger = log.Default()
	}
	return &Message{logger: logger, provider: provider}
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

	if s.provider == nil {
		return fmt.Errorf("webhook config provider is nil")
	}
	cfg, err := s.provider.Get(ctx, event.PhoneNumberID)
	if err != nil {
		return fmt.Errorf("resolve webhook config for phone number %q: %w", event.PhoneNumberID, err)
	}
	if cfg.URL == "" {
		s.logger.Printf("webhook not configured for phone number %q; skipping forward", event.PhoneNumberID)
		return nil
	}
	if err := forwardWebhookWithRetry(ctx, cfg, payload); err != nil {
		return fmt.Errorf("forward inbound WABA webhook: %w", err)
	}
	return nil
}

const webhookForwardAttempts = 3

var webhookForwardBackoffs = []time.Duration{200 * time.Millisecond, 400 * time.Millisecond, 800 * time.Millisecond}

// forwardWebhookWithRetry forwards the payload through a per-call webhook
// client, retrying transient failures with bounded exponential backoff.
func forwardWebhookWithRetry(ctx context.Context, cfg domain.WebhookConfig, payload domain.WebhookPayload) error {
	client := webhook.NewClient(cfg.URL, cfg.Secret)
	var lastErr error
	for attempt := 0; attempt < webhookForwardAttempts; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(webhookForwardBackoffs[attempt-1]):
			}
		}
		lastErr = client.Forward(ctx, payload)
		if lastErr == nil {
			return nil
		}
	}
	return lastErr
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
	case domain.MessageEventTypeContacts:
		contacts := make([]domain.ContactObject, 0, len(message.Contacts))
		for _, c := range message.Contacts {
			contacts = append(contacts, mapContactEvent(c))
		}
		result.Contacts = contacts
	case domain.MessageEventTypeSystem:
		if message.System != nil {
			result.System = &domain.SystemMessage{
				Body: message.System.Body,
				WaID: message.System.WaID,
				Type: message.System.Type,
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

func mapContactEvent(c domain.ContactEvent) domain.ContactObject {
	obj := domain.ContactObject{
		Birthday: c.Birthday,
		Name: domain.NameObject{
			FormattedName: c.Name.FormattedName,
			FirstName:     c.Name.FirstName,
			LastName:      c.Name.LastName,
			MiddleName:    c.Name.MiddleName,
			Prefix:        c.Name.Prefix,
			Suffix:        c.Name.Suffix,
		},
		Org: domain.OrgObject{
			Company:    c.Org.Company,
			Department: c.Org.Department,
			Title:      c.Org.Title,
		},
	}
	for _, p := range c.Phones {
		obj.Phones = append(obj.Phones, domain.PhoneObject{
			Phone: p.Phone,
			Type:  p.Type,
			WaID:  p.WaID,
		})
	}
	for _, e := range c.Emails {
		obj.Emails = append(obj.Emails, domain.EmailObject{
			Email: e.Email,
			Type:  e.Type,
		})
	}
	for _, a := range c.Addresses {
		obj.Addresses = append(obj.Addresses, domain.AddressObject{
			Street:      a.Street,
			City:        a.City,
			State:       a.State,
			Zip:         a.Zip,
			Country:     a.Country,
			CountryCode: a.CountryCode,
		})
	}
	for _, u := range c.URLs {
		obj.URLs = append(obj.URLs, domain.URLObject{
			URL:  u.URL,
			Type: u.Type,
		})
	}
	return obj
}
