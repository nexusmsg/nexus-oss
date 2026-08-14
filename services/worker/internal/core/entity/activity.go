package entity

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

const (
	// ActivityType* are the type discriminator values for activity_events.
	ActivityTypeAPIRequest      = "api_request"
	ActivityTypeWhatsAppEvent   = "whatsapp_event"
	ActivityTypeWebhookDelivery = "webhook_delivery"
)

const (
	// ActivityStatus* are the status values for activity_events.
	ActivityStatusOK        = "ok"
	ActivityStatusError     = "error"
	ActivityStatusAttempted = "attempted"
)

// ActivityEvent mirrors the activity_events table row (migration 000013). The
// serial uuid is generated in app code (not the DB default) so callers can link
// source_activity_serial without awaiting the write (observability plan §10
// R3). The payload is kind-specific detail stored as jsonb; it follows the Job
// payload convention of json.RawMessage.
type ActivityEvent struct {
	Serial               uuid.UUID  `json:"serial"`
	Type                 string     `json:"type"`
	Status               string     `json:"status"`
	PhoneNumberID        string     `json:"phone_number_id,omitempty"`
	BusinessAccountID    string     `json:"business_account_id,omitempty"`
	Summary              string     `json:"summary"`
	JobSerial            *uuid.UUID `json:"job_serial,omitempty"`
	WAMessageID          string     `json:"wa_message_id,omitempty"`
	SourceActivitySerial *uuid.UUID `json:"source_activity_serial,omitempty"`
	ResourceType         string     `json:"resource_type,omitempty"`
	ResourceSerial       *uuid.UUID `json:"resource_serial,omitempty"`
	// RequestSerial is text: an api_key serial or the literal "bootstrap" (not a
	// uuid). See migration 000013 / plan §10 R2.
	RequestSerial string          `json:"request_serial,omitempty"`
	Payload       json.RawMessage `json:"payload,omitempty"`
	CreatedAt     time.Time       `json:"created_at"`
}
