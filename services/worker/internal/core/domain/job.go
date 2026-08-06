package domain

import (
	"encoding/json"
	"time"
)

const (
	JobTypeSendMessage = "send_message"
	JobTypePairing     = "pairing"
	JobTypeLogout      = "logout"

	JobStatusPending   = "pending"
	JobStatusClaimed   = "claimed"
	JobStatusSucceeded = "succeeded"
	JobStatusFailed    = "failed"
)

// Job mirrors the outbound job queue row in the jobs table.
type Job struct {
	ID              int64
	Serial          string
	SourceJobSerial string // whatsmeow_jobs.source_job_serial (uuid; "" when none)
	Type            string
	PhoneNumberID   string
	Payload         json.RawMessage
	Status          string
	Attempts        int
	MaxAttempts     int
	AvailableAt     time.Time
	ClaimedAt       time.Time
	CompletedAt     time.Time
	ClaimedBy       string
	LastError       string
	Result          json.RawMessage
	IDempotencyKey  string
}

// JobResult is the persisted result of a completed job. wa_message_id is the
// hard contract the API reads to correlate a job with the WhatsApp message.
type JobResult struct {
	WA_MESSAGE_ID string `json:"wa_message_id"`
}

// WebhookConfig is the forwarding configuration for a phone number.
type WebhookConfig struct {
	URL    string
	Secret string
}
