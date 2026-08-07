package dto

import "time"

// JobDTO mirrors one queue table row (jobs or whatsmeow_jobs), including the
// whatsmeow_jobs-only source_job_serial column. Nullable columns are pointers
// so scanning and SQL binding can distinguish NULL from zero values.
type JobDTO struct {
	ID              int64
	Serial          string
	SourceJobSerial *string
	Type            string
	PhoneNumberID   string
	Payload         []byte
	Status          string
	Attempts        int
	MaxAttempts     int
	AvailableAt     time.Time
	ClaimedBy       *string
	ClaimedAt       *time.Time
	CompletedAt     *time.Time
	LastError       *string
	Result          *[]byte
	IDempotencyKey  *string
}
