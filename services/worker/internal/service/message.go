package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
)

// sleepFunc applies a delay between forward retry attempts, returning ctx.Err()
// when the context is canceled before the delay completes.
type sleepFunc func(ctx context.Context, d time.Duration) error

// defaultSleep is the production sleeper: a context-aware real-clock wait.
var defaultSleep sleepFunc = func(ctx context.Context, d time.Duration) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(d):
		return nil
	}
}

type Message struct {
	logger    *log.Logger
	provider  ports.WebhookConfigProvider
	forwarder ports.WebhookForwarder
	sleep     sleepFunc
}

var _ ports.MessageService = (*Message)(nil)

func NewMessage(logger *log.Logger, provider ports.WebhookConfigProvider, forwarder ports.WebhookForwarder) *Message {
	if logger == nil {
		logger = log.Default()
	}
	return &Message{logger: logger, provider: provider, forwarder: forwarder, sleep: defaultSleep}
}

// WithSleep replaces the inter-retry sleeper (default: real clock). Tests
// inject a recording sleeper to assert the backoff sequence hermetically.
func (m *Message) WithSleep(sleep sleepFunc) *Message {
	if sleep != nil {
		m.sleep = sleep
	}
	return m
}

func (s *Message) Inbound(ctx context.Context, event *entity.InboundEvent) error {
	if event == nil {
		return fmt.Errorf("inbound event is nil")
	}
	if event.IsFromMe {
		return nil
	}

	payload := entity.WebhookPayload{
		Object: "whatsapp_business_account",
		Entry: []entity.Entry{{
			ID: event.BusinessAccountID,
			Changes: []entity.Change{{
				Field: "messages",
				Value: entity.Value{
					MessagingProduct: "whatsapp",
					Metadata: entity.Metadata{
						DisplayPhoneNumber: event.DisplayPhoneNumber,
						PhoneNumberID:      event.PhoneNumberID,
					},
					Contacts: []entity.Contact{{
						Profile: entity.Profile{Name: event.ProfileName},
						WaID:    event.WhatsAppID,
					}},
					Messages: []entity.Message{mapMessage(event.Message)},
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
	if s.forwarder == nil {
		return fmt.Errorf("webhook forwarder is nil")
	}
	if err := s.forwardWebhookWithRetry(ctx, s.forwarder, cfg, payload); err != nil {
		return fmt.Errorf("forward inbound WABA webhook: %w", err)
	}
	return nil
}

// webhookForwardAttempts is the total number of forward attempts: the initial
// attempt plus one retry per entry in webhookForwardBackoffs.
const webhookForwardAttempts = 4

var webhookForwardBackoffs = []time.Duration{200 * time.Millisecond, 400 * time.Millisecond, 800 * time.Millisecond}

// forwardWebhookWithRetry forwards the payload through the injected
// forwarder, retrying transient failures with bounded exponential backoff
// applied through the injected sleeper (real clock in production).
func (s *Message) forwardWebhookWithRetry(ctx context.Context, forwarder ports.WebhookForwarder, cfg entity.WebhookConfig, payload entity.WebhookPayload) error {
	sleep := s.sleep
	if sleep == nil {
		sleep = defaultSleep
	}
	var lastErr error
	for attempt := 0; attempt < webhookForwardAttempts; attempt++ {
		if attempt > 0 {
			if err := sleep(ctx, webhookForwardBackoffs[attempt-1]); err != nil {
				return err
			}
		}
		lastErr = forwarder.Forward(ctx, cfg, payload)
		if lastErr == nil {
			return nil
		}
	}
	return lastErr
}

func mapMessage(message entity.MessageEvent) entity.Message {
	result := entity.Message{
		From:      message.From,
		ID:        message.ID,
		Timestamp: message.Timestamp,
		Type:      string(message.Type),
	}

	switch message.Type {
	case entity.MessageEventTypeText:
		result.Text = &entity.Text{Body: message.Text}
	case entity.MessageEventTypeLocation:
		if message.Location != nil {
			result.Location = &entity.Location{
				Latitude:  message.Location.Latitude,
				Longitude: message.Location.Longitude,
				Name:      message.Location.Name,
				Address:   message.Location.Address,
			}
		}
	case entity.MessageEventTypeReaction:
		if message.Reaction != nil {
			result.Reaction = &entity.Reaction{
				MessageID: message.Reaction.MessageID,
				Emoji:     message.Reaction.Emoji,
			}
		}
	case entity.MessageEventTypeInteractive:
		if message.Interactive != nil {
			result.Interactive = &entity.Interactive{
				Type: message.Interactive.Type,
			}
			if message.Interactive.ButtonReply != nil {
				result.Interactive.ButtonReply = &entity.ButtonReply{
					ID:    message.Interactive.ButtonReply.ID,
					Title: message.Interactive.ButtonReply.Title,
				}
			}
			if message.Interactive.ListReply != nil {
				result.Interactive.ListReply = &entity.ListReply{
					ID:          message.Interactive.ListReply.ID,
					Title:       message.Interactive.ListReply.Title,
					Description: message.Interactive.ListReply.Description,
				}
			}
		}
	case entity.MessageEventTypeContacts:
		contacts := make([]entity.ContactObject, 0, len(message.Contacts))
		for _, c := range message.Contacts {
			contacts = append(contacts, mapContactEvent(c))
		}
		result.Contacts = contacts
	case entity.MessageEventTypeSystem:
		if message.System != nil {
			result.System = &entity.SystemMessage{
				Body: message.System.Body,
				WaID: message.System.WaID,
				Type: message.System.Type,
			}
		}
	}

	if message.Context != nil {
		result.Context = &entity.MessageContext{
			ID:   message.Context.ID,
			From: message.Context.From,
		}
	}

	return result
}

func mapContactEvent(c entity.ContactEvent) entity.ContactObject {
	obj := entity.ContactObject{
		Birthday: c.Birthday,
		Name: entity.NameObject{
			FormattedName: c.Name.FormattedName,
			FirstName:     c.Name.FirstName,
			LastName:      c.Name.LastName,
			MiddleName:    c.Name.MiddleName,
			Prefix:        c.Name.Prefix,
			Suffix:        c.Name.Suffix,
		},
		Org: entity.OrgObject{
			Company:    c.Org.Company,
			Department: c.Org.Department,
			Title:      c.Org.Title,
		},
	}
	for _, p := range c.Phones {
		obj.Phones = append(obj.Phones, entity.PhoneObject{
			Phone: p.Phone,
			Type:  p.Type,
			WaID:  p.WaID,
		})
	}
	for _, e := range c.Emails {
		obj.Emails = append(obj.Emails, entity.EmailObject{
			Email: e.Email,
			Type:  e.Type,
		})
	}
	for _, a := range c.Addresses {
		obj.Addresses = append(obj.Addresses, entity.AddressObject{
			Street:      a.Street,
			City:        a.City,
			State:       a.State,
			Zip:         a.Zip,
			Country:     a.Country,
			CountryCode: a.CountryCode,
		})
	}
	for _, u := range c.URLs {
		obj.URLs = append(obj.URLs, entity.URLObject{
			URL:  u.URL,
			Type: u.Type,
		})
	}
	return obj
}
