package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
	"github.com/google/uuid"
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
	recorder  ports.ActivityRecorder
	sleep     sleepFunc
}

var _ ports.MessageService = (*Message)(nil)

// NewMessage builds the inbound message service. recorder is the observability
// activity recorder (ports.ActivityRecorder); it is stored for use by capture
// points added in a later task and nil-safe until then.
func NewMessage(logger *log.Logger, provider ports.WebhookConfigProvider, forwarder ports.WebhookForwarder, recorder ports.ActivityRecorder) *Message {
	if logger == nil {
		logger = log.Default()
	}
	return &Message{logger: logger, provider: provider, forwarder: forwarder, recorder: recorder, sleep: defaultSleep}
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
	sourceSerial := event.ActivitySerial
	if err := s.forwardWebhookWithRetry(ctx, s.forwarder, cfg, payload, sourceSerial); err != nil {
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
// applied through the injected sleeper (real clock in production). It records
// one activity row per delivery attempt and a terminal webhook_delivery row
// (plan §3/§4). Recorder calls are fire-and-forget and never mutate lastErr or
// any retry/backoff control flow (plan §10 R3): a recorder failure is logged
// and swallowed, so it can never trigger a webhook retry.
func (s *Message) forwardWebhookWithRetry(ctx context.Context, forwarder ports.WebhookForwarder, cfg entity.WebhookConfig, payload entity.WebhookPayload, sourceSerial uuid.UUID) error {
	sleep := s.sleep
	if sleep == nil {
		sleep = defaultSleep
	}
	var lastErr error
	attemptStatuses := make([]attemptStatus, 0, webhookForwardAttempts)
	eventName := webhookEventName(payload)
	for attempt := 0; attempt < webhookForwardAttempts; attempt++ {
		if attempt > 0 {
			if err := sleep(ctx, webhookForwardBackoffs[attempt-1]); err != nil {
				return err
			}
		}
		lastErr = forwarder.Forward(ctx, cfg, payload)
		// Record a per-attempt row regardless of outcome; the attempt number is
		// 1-based for readability. The capture calls below never touch lastErr
		// or the retry control flow — outcome data goes only into the payload.
		attemptStatuses = append(attemptStatuses, attemptStatus{
			attempt:    attempt + 1,
			err:        lastErr,
			statusCode: 0, // the forwarder port returns only error, not status codes
		})
		s.recordDeliveryAttempt(ctx, cfg, payload, eventName, attempt+1, sourceSerial)
		if lastErr == nil {
			s.recordDeliveryTerminal(ctx, cfg, payload, eventName, attemptStatuses, entity.ActivityStatusOK, "delivered", sourceSerial)
			return nil
		}
	}
	// Exhausted the retry budget: terminal row is error, outcome is the last
	// failure reason (stringified). lastErr is returned unchanged to the caller.
	s.recordDeliveryTerminal(ctx, cfg, payload, eventName, attemptStatuses, entity.ActivityStatusError, errMessage(lastErr), sourceSerial)
	return lastErr
}

// attemptStatus is the per-attempt detail captured for the terminal row's
// attempt_statuses array (plan §3).
type attemptStatus struct {
	attempt    int
	err        error
	statusCode int
}

// recordDeliveryAttempt records one fire-and-forget webhook_delivery row with
// status 'attempted' for a single forward attempt. It never touches the
// forward path; a recorder error is logged and swallowed.
func (s *Message) recordDeliveryAttempt(ctx context.Context, cfg entity.WebhookConfig, payload entity.WebhookPayload, event string, attempt int, sourceSerial uuid.UUID) {
	if s.recorder == nil {
		return
	}
	raw, err := json.Marshal(map[string]any{
		"webhook_config_serial": nil, // not exposed by the provider; reserved for correlation
		"url":                   cfg.URL,
		"event":                 event,
		"attempt":               attempt,
	})
	if err != nil {
		s.logger.Printf("observability: marshal webhook attempt payload: %v", err)
		return
	}
	eventRecord := entity.ActivityEvent{
		Serial:               uuid.New(),
		Type:                 entity.ActivityTypeWebhookDelivery,
		Status:               entity.ActivityStatusAttempted,
		PhoneNumberID:        phoneFromPayload(payload),
		Summary:              fmt.Sprintf("webhook attempt %d → %s", attempt, cfg.URL),
		SourceActivitySerial: nilIfNilUUID(sourceSerial),
		Payload:              raw,
	}
	s.fireRecord(ctx, eventRecord)
}

// recordDeliveryTerminal records the single terminal webhook_delivery row
// (status 'ok' or 'error') summarizing all attempts. It never affects the
// forward path; a recorder error is logged and swallowed.
func (s *Message) recordDeliveryTerminal(ctx context.Context, cfg entity.WebhookConfig, payload entity.WebhookPayload, event string, attempts []attemptStatus, status, finalOutcome string, sourceSerial uuid.UUID) {
	if s.recorder == nil {
		return
	}
	statuses := make([]map[string]any, 0, len(attempts))
	for _, a := range attempts {
		entry := map[string]any{"attempt": a.attempt}
		if a.err != nil {
			entry["error"] = a.err.Error()
		}
		if a.statusCode != 0 {
			entry["status_code"] = a.statusCode
		}
		statuses = append(statuses, entry)
	}
	raw, err := json.Marshal(map[string]any{
		"webhook_config_serial": nil,
		"url":                   cfg.URL,
		"event":                 event,
		"attempts":              len(attempts),
		"attempt_statuses":      statuses,
		"final_outcome":         finalOutcome,
	})
	if err != nil {
		s.logger.Printf("observability: marshal webhook terminal payload: %v", err)
		return
	}
	eventRecord := entity.ActivityEvent{
		Serial:               uuid.New(),
		Type:                 entity.ActivityTypeWebhookDelivery,
		Status:               status,
		PhoneNumberID:        phoneFromPayload(payload),
		Summary:              fmt.Sprintf("webhook %s → %s", finalOutcome, cfg.URL),
		SourceActivitySerial: nilIfNilUUID(sourceSerial),
		Payload:              raw,
	}
	s.fireRecord(ctx, eventRecord)
}

// fireRecord records the event fire-and-forget in a goroutine detached from the
// caller's cancellation (plan §10 R3), swallowing and logging any recorder
// error so observability never affects the forward path.
func (s *Message) fireRecord(ctx context.Context, event entity.ActivityEvent) {
	if s.recorder == nil {
		return
	}
	go func() {
		if err := s.recorder.Record(context.WithoutCancel(ctx), event); err != nil {
			s.logger.Printf("observability: record %s %s: %v", event.Type, event.Serial, err)
		}
	}()
}

// webhookEventName extracts the WABA event name from the payload (always
// "messages" for inbound events today).
func webhookEventName(payload entity.WebhookPayload) string {
	if len(payload.Entry) > 0 && len(payload.Entry[0].Changes) > 0 {
		return payload.Entry[0].Changes[0].Field
	}
	return ""
}

// phoneFromPayload returns the phone number id from the payload metadata, used
// for the delivery rows' tenant key (null when absent).
func phoneFromPayload(payload entity.WebhookPayload) string {
	if len(payload.Entry) > 0 && len(payload.Entry[0].Changes) > 0 {
		return payload.Entry[0].Changes[0].Value.Metadata.PhoneNumberID
	}
	return ""
}

// nilIfNilUUID returns nil for uuid.Nil, else a pointer to the value, so the
// source_activity_serial column stays NULL (not zero-uuid) when linking is
// absent.
func nilIfNilUUID(u uuid.UUID) *uuid.UUID {
	if u == uuid.Nil {
		return nil
	}
	v := u
	return &v
}

// errMessage returns the stringified error reason, or "unknown" when nil.
func errMessage(err error) string {
	if err == nil {
		return "unknown"
	}
	return err.Error()
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
