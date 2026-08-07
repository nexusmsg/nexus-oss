package dto

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
)

// NormalizeForInsert maps an entity job into the queue row model and applies
// the insert-time defaults: an empty payload binds as the jsonb empty object
// "{}" and a non-positive MaxAttempts binds as entity.DefaultMaxAttempts.
func NormalizeForInsert(job entity.Job) JobDTO {
	d := FromEntity(job)
	if len(d.Payload) == 0 {
		d.Payload = []byte("{}")
	}
	if d.MaxAttempts <= 0 {
		d.MaxAttempts = entity.DefaultMaxAttempts
	}
	return d
}

// FromEntity maps an entity job into the queue row model, coalescing empty
// strings and zero values back to the NULL semantics the row scan produces
// ("" <-> NULL, zero time <-> NULL, empty payload <-> NULL).
func FromEntity(job entity.Job) JobDTO {
	return JobDTO{
		ID:              job.ID,
		Serial:          job.Serial,
		SourceJobSerial: nilIfEmpty(job.SourceJobSerial),
		Type:            job.Type,
		PhoneNumberID:   job.PhoneNumberID,
		Payload:         job.Payload,
		Status:          job.Status,
		Attempts:        job.Attempts,
		MaxAttempts:     job.MaxAttempts,
		AvailableAt:     job.AvailableAt,
		ClaimedBy:       nilIfEmpty(job.ClaimedBy),
		ClaimedAt:       timePtr(job.ClaimedAt),
		CompletedAt:     timePtr(job.CompletedAt),
		LastError:       nilIfEmpty(job.LastError),
		Result:          bytesPtr(job.Result),
		IDempotencyKey:  nilIfEmpty(job.IDempotencyKey),
	}
}

// ToEntity maps a scanned queue row back into the entity job, dereferencing
// NULL columns to zero values exactly like the store's historical row
// conversion.
func ToEntity(d JobDTO) (entity.Job, error) {
	if d.Serial == "" {
		return entity.Job{}, errors.New("queue dto: job serial is empty")
	}
	return entity.Job{
		ID:              d.ID,
		Serial:          d.Serial,
		SourceJobSerial: derefString(d.SourceJobSerial),
		Type:            d.Type,
		PhoneNumberID:   d.PhoneNumberID,
		Payload:         d.Payload,
		Status:          d.Status,
		Attempts:        d.Attempts,
		MaxAttempts:     d.MaxAttempts,
		AvailableAt:     d.AvailableAt,
		ClaimedAt:       derefTime(d.ClaimedAt),
		CompletedAt:     derefTime(d.CompletedAt),
		ClaimedBy:       derefString(d.ClaimedBy),
		LastError:       derefString(d.LastError),
		Result:          derefBytes(d.Result),
		IDempotencyKey:  derefString(d.IDempotencyKey),
	}, nil
}

// ToSession maps a scanned session row back into the entity session.
func ToSession(d SessionDTO) entity.Session {
	return entity.Session{
		PhoneNumberID:     d.PhoneNumberID,
		Number:            d.Number,
		DisplayPhone:      d.DisplayPhone,
		BusinessAccountID: d.BusinessAccountID,
		Status:            d.Status,
	}
}

func derefTime(v *time.Time) time.Time {
	if v == nil {
		return time.Time{}
	}
	return *v
}

func derefString(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

func derefBytes(v *[]byte) []byte {
	if v == nil {
		return nil
	}
	return *v
}

func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func timePtr(t time.Time) *time.Time {
	if t.IsZero() {
		return nil
	}
	return &t
}

func bytesPtr(b json.RawMessage) *[]byte {
	if len(b) == 0 {
		return nil
	}
	v := []byte(b)
	return &v
}
