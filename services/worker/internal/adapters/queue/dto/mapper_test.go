package dto

import (
	"bytes"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
	"github.com/jackc/pgx/v5"
)

// stubScanner mimics the Scan(dest ...any) error contract shared by *pgx.Row
// and *pgx.Rows, so the dto scan helpers can be exercised hermetically. values
// are written positionally into destinations that match by concrete type.
type stubScanner struct {
	dest   []any
	callN  int
	err    error
	values []any
}

func (s *stubScanner) Scan(dest ...any) error {
	if s.err != nil {
		return s.err
	}
	s.dest = dest
	s.callN++
	for i, value := range s.values {
		if i >= len(dest) {
			break
		}
		switch d := dest[i].(type) {
		case *string:
			if v, ok := value.(string); ok {
				*d = v
			}
		case *int:
			if v, ok := value.(int); ok {
				*d = v
			}
		case *int64:
			if v, ok := value.(int64); ok {
				*d = v
			}
		case *[]byte:
			if v, ok := value.([]byte); ok {
				*d = v
			}
		case *time.Time:
			if v, ok := value.(time.Time); ok {
				*d = v
			}
		case **string:
			if v, ok := value.(*string); ok {
				*d = v
			}
		case **time.Time:
			if v, ok := value.(*time.Time); ok {
				*d = v
			}
		case **[]byte:
			if v, ok := value.(*[]byte); ok {
				*d = v
			}
		}
	}
	return nil
}

func strPtr(s string) *string { return &s }

// sessionRowValues is the column content ScanSession reads for a session row.
func sessionRowValues() []any {
	return []any{
		"phone-1",
		"628123456789",
		"+62 812-3456-789",
		"waba-1",
		entity.SessionStatusConnected,
	}
}

func TestScanSession(t *testing.T) {
	stub := &stubScanner{values: sessionRowValues()}
	d, err := ScanSession(stub)
	if err != nil {
		t.Fatalf("ScanSession() error = %v", err)
	}
	if stub.callN != 1 {
		t.Fatalf("Scan called %d times, want 1", stub.callN)
	}
	got := ToSession(d)
	want := entity.Session{
		PhoneNumberID:     "phone-1",
		Number:            "628123456789",
		DisplayPhone:      "+62 812-3456-789",
		BusinessAccountID: "waba-1",
		Status:            entity.SessionStatusConnected,
	}
	if got != want {
		t.Errorf("ToSession(ScanSession()) = %+v, want %+v", got, want)
	}
}

func TestScanSessionReturnsError(t *testing.T) {
	boom := errors.New("boom")
	_, err := ScanSession(&stubScanner{err: boom})
	if !errors.Is(err, boom) {
		t.Fatalf("ScanSession() error = %v, want wrapped %v", err, boom)
	}
}

func TestScanSessionPropagatesNoRows(t *testing.T) {
	_, err := ScanSession(&stubScanner{err: pgx.ErrNoRows})
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("ScanSession() error = %v, want ErrNoRows", err)
	}
}

// TestScanSessionColumnOrder guards the SELECT/Scan column contract: the scan
// helper must receive 5 destinations in the exact order the queries select.
func TestScanSessionColumnOrder(t *testing.T) {
	stub := &stubScanner{values: sessionRowValues()}
	if _, err := ScanSession(stub); err != nil {
		t.Fatalf("ScanSession() error = %v", err)
	}
	if len(stub.dest) != 5 {
		t.Fatalf("Scan received %d destinations, want 5", len(stub.dest))
	}
	for i, d := range stub.dest {
		if _, ok := d.(*string); !ok {
			t.Fatalf("destination %d is %T, want *string", i, d)
		}
	}
}

// jobRowValues returns the column values ScanJob reads for a claimed job row,
// with an optional trailing source_job_serial value for whatsmeow_jobs rows.
func jobRowValues(now time.Time, sourceSerial *string) []any {
	return append([]any{
		int64(7),
		"serial-1",
		entity.JobTypeSendMessage,
		"phone-1",
		[]byte(`{"to":"6281"}`),
		entity.JobStatusClaimed,
		2,
		5,
		now,
		strPtr("host-1"),
		func() *time.Time { t := now.Add(time.Hour); return &t }(),
		func() *time.Time { t := now.Add(2 * time.Hour); return &t }(),
		strPtr("send failed"),
		func() *[]byte { b := []byte(`{"wa_message_id":"wamid-1"}`); return &b }(),
		strPtr("key-1"),
	}, sourceSerial)
}

func TestScanJob(t *testing.T) {
	now := time.Date(2026, 8, 7, 12, 0, 0, 0, time.UTC)
	source := "jobs-serial-1"

	want := func(sourceSerial *string) JobDTO {
		return JobDTO{
			ID:              7,
			Serial:          "serial-1",
			SourceJobSerial: sourceSerial,
			Type:            entity.JobTypeSendMessage,
			PhoneNumberID:   "phone-1",
			Payload:         []byte(`{"to":"6281"}`),
			Status:          entity.JobStatusClaimed,
			Attempts:        2,
			MaxAttempts:     5,
			AvailableAt:     now,
			ClaimedBy:       strPtr("host-1"),
			ClaimedAt:       func() *time.Time { t := now.Add(time.Hour); return &t }(),
			CompletedAt:     func() *time.Time { t := now.Add(2 * time.Hour); return &t }(),
			LastError:       strPtr("send failed"),
			Result:          func() *[]byte { b := []byte(`{"wa_message_id":"wamid-1"}`); return &b }(),
			IDempotencyKey:  strPtr("key-1"),
		}
	}

	cases := []struct {
		name          string
		includeSource bool
		values        []any
		want          JobDTO
	}{
		{"jobs table omits source_job_serial", false, jobRowValues(now, nil), want(nil)},
		{"whatsmeow_jobs table includes source_job_serial", true, jobRowValues(now, &source), want(&source)},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			stub := &stubScanner{values: tc.values}
			got, err := ScanJob(stub, tc.includeSource)
			if err != nil {
				t.Fatalf("ScanJob() error = %v", err)
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("ScanJob() = %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestScanJobReturnsError(t *testing.T) {
	boom := errors.New("boom")
	if _, err := ScanJob(&stubScanner{err: boom}, false); !errors.Is(err, boom) {
		t.Fatalf("ScanJob() error = %v, want wrapped %v", err, boom)
	}
}

// TestScanJobColumnOrder guards the SELECT/Scan column contract: the scan
// helper must receive 15 destinations for the jobs table and 16 (with
// source_job_serial last) for whatsmeow_jobs, in the query's column order.
func TestScanJobColumnOrder(t *testing.T) {
	now := time.Date(2026, 8, 7, 12, 0, 0, 0, time.UTC)
	typeOf := func(v any) reflect.Type { return reflect.TypeOf(v) }
	baseTypes := []reflect.Type{
		typeOf((*int64)(nil)), typeOf((*string)(nil)), typeOf((*string)(nil)), typeOf((*string)(nil)), typeOf((*[]byte)(nil)),
		typeOf((*string)(nil)), typeOf((*int)(nil)), typeOf((*int)(nil)), typeOf((*time.Time)(nil)), typeOf((**string)(nil)),
		typeOf((**time.Time)(nil)), typeOf((**time.Time)(nil)), typeOf((**string)(nil)), typeOf((**[]byte)(nil)), typeOf((**string)(nil)),
	}
	cases := []struct {
		name      string
		include   bool
		wantTypes []reflect.Type
	}{
		{"jobs table", false, baseTypes},
		{"whatsmeow_jobs table", true, append(append([]reflect.Type{}, baseTypes...), typeOf((**string)(nil)))},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			stub := &stubScanner{values: jobRowValues(now, strPtr("source-serial-1"))}
			if _, err := ScanJob(stub, tc.include); err != nil {
				t.Fatalf("ScanJob() error = %v", err)
			}
			if len(stub.dest) != len(tc.wantTypes) {
				t.Fatalf("ScanJob received %d destinations, want %d", len(stub.dest), len(tc.wantTypes))
			}
			for i, d := range stub.dest {
				if got := reflect.TypeOf(d); got != tc.wantTypes[i] {
					t.Errorf("destination %d is %v, want %v", i, got, tc.wantTypes[i])
				}
			}
		})
	}
}

func TestFromEntity(t *testing.T) {
	now := time.Date(2026, 8, 7, 12, 0, 0, 0, time.UTC)
	job := entity.Job{
		ID:              7,
		Serial:          "serial-1",
		SourceJobSerial: "jobs-serial-1",
		Type:            entity.JobTypeSendMessage,
		PhoneNumberID:   "phone-1",
		Payload:         json.RawMessage(`{"to":"6281"}`),
		Status:          entity.JobStatusClaimed,
		Attempts:        2,
		MaxAttempts:     5,
		AvailableAt:     now,
		ClaimedAt:       now.Add(time.Hour),
		CompletedAt:     now.Add(2 * time.Hour),
		ClaimedBy:       "host-1",
		LastError:       "send failed",
		Result:          json.RawMessage(`{"wa_message_id":"wamid-1"}`),
		IDempotencyKey:  "key-1",
	}

	got := FromEntity(job)
	want := JobDTO{
		ID:              7,
		Serial:          "serial-1",
		SourceJobSerial: strPtr("jobs-serial-1"),
		Type:            entity.JobTypeSendMessage,
		PhoneNumberID:   "phone-1",
		Payload:         []byte(`{"to":"6281"}`),
		Status:          entity.JobStatusClaimed,
		Attempts:        2,
		MaxAttempts:     5,
		AvailableAt:     now,
		ClaimedBy:       strPtr("host-1"),
		ClaimedAt:       timePtr(now.Add(time.Hour)),
		CompletedAt:     timePtr(now.Add(2 * time.Hour)),
		LastError:       strPtr("send failed"),
		Result:          bytesPtr(json.RawMessage(`{"wa_message_id":"wamid-1"}`)),
		IDempotencyKey:  strPtr("key-1"),
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("FromEntity() = %+v, want %+v", got, want)
	}
}

// TestFromEntityCoalescesEmptyValues guards the NULL semantics: empty strings
// and zero values map to nil pointers, so SQL binding writes NULL.
func TestFromEntityCoalescesEmptyValues(t *testing.T) {
	got := FromEntity(entity.Job{})
	if !reflect.DeepEqual(got, JobDTO{}) {
		t.Errorf("FromEntity(empty job) = %+v, want all zero values", got)
	}
}

func TestToEntity(t *testing.T) {
	now := time.Date(2026, 8, 7, 12, 0, 0, 0, time.UTC)
	d := JobDTO{
		ID:              7,
		Serial:          "serial-1",
		SourceJobSerial: strPtr("jobs-serial-1"),
		Type:            entity.JobTypeSendMessage,
		PhoneNumberID:   "phone-1",
		Payload:         []byte(`{"to":"6281"}`),
		Status:          entity.JobStatusClaimed,
		Attempts:        2,
		MaxAttempts:     5,
		AvailableAt:     now,
		ClaimedBy:       strPtr("host-1"),
		ClaimedAt:       timePtr(now.Add(time.Hour)),
		CompletedAt:     timePtr(now.Add(2 * time.Hour)),
		LastError:       strPtr("send failed"),
		Result:          bytesPtr(json.RawMessage(`{"wa_message_id":"wamid-1"}`)),
		IDempotencyKey:  strPtr("key-1"),
	}

	got, err := ToEntity(d)
	if err != nil {
		t.Fatalf("ToEntity() error = %v", err)
	}
	want := entity.Job{
		ID:              7,
		Serial:          "serial-1",
		SourceJobSerial: "jobs-serial-1",
		Type:            entity.JobTypeSendMessage,
		PhoneNumberID:   "phone-1",
		Payload:         json.RawMessage(`{"to":"6281"}`),
		Status:          entity.JobStatusClaimed,
		Attempts:        2,
		MaxAttempts:     5,
		AvailableAt:     now,
		ClaimedAt:       now.Add(time.Hour),
		CompletedAt:     now.Add(2 * time.Hour),
		ClaimedBy:       "host-1",
		LastError:       "send failed",
		Result:          json.RawMessage(`{"wa_message_id":"wamid-1"}`),
		IDempotencyKey:  "key-1",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("ToEntity() = %+v, want %+v", got, want)
	}
}

// TestToEntityDereferencesNullColumns guards the scan semantics: NULL columns
// (nil pointers) map back to zero values.
func TestToEntityDereferencesNullColumns(t *testing.T) {
	got, err := ToEntity(JobDTO{ID: 1, Serial: "serial-1", Type: entity.JobTypeSendMessage})
	if err != nil {
		t.Fatalf("ToEntity() error = %v", err)
	}
	want := entity.Job{ID: 1, Serial: "serial-1", Type: entity.JobTypeSendMessage}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("ToEntity() = %+v, want %+v", got, want)
	}
}

func TestToEntityRejectsEmptySerial(t *testing.T) {
	if _, err := ToEntity(JobDTO{}); err == nil {
		t.Fatal("ToEntity() with empty serial returned nil error")
	}
}

func TestJobRoundTrip(t *testing.T) {
	now := time.Date(2026, 8, 7, 12, 0, 0, 0, time.UTC)
	job := entity.Job{
		ID:              7,
		Serial:          "serial-1",
		SourceJobSerial: "jobs-serial-1",
		Type:            entity.JobTypeSendMessage,
		PhoneNumberID:   "phone-1",
		Payload:         json.RawMessage(`{"to":"6281"}`),
		Status:          entity.JobStatusClaimed,
		Attempts:        2,
		MaxAttempts:     5,
		AvailableAt:     now,
		ClaimedAt:       now.Add(time.Hour),
		CompletedAt:     now.Add(2 * time.Hour),
		ClaimedBy:       "host-1",
		LastError:       "send failed",
		Result:          json.RawMessage(`{"wa_message_id":"wamid-1"}`),
		IDempotencyKey:  "key-1",
	}

	got, err := ToEntity(FromEntity(job))
	if err != nil {
		t.Fatalf("ToEntity(FromEntity()) error = %v", err)
	}
	if !reflect.DeepEqual(got, job) {
		t.Errorf("round trip = %+v, want %+v", got, job)
	}
}

func TestToSession(t *testing.T) {
	d := SessionDTO{
		PhoneNumberID:     "phone-1",
		Number:            "628123456789",
		DisplayPhone:      "+62 812-3456-789",
		BusinessAccountID: "waba-1",
		Status:            entity.SessionStatusConnected,
	}
	want := entity.Session{
		PhoneNumberID:     "phone-1",
		Number:            "628123456789",
		DisplayPhone:      "+62 812-3456-789",
		BusinessAccountID: "waba-1",
		Status:            entity.SessionStatusConnected,
	}
	if got := ToSession(d); got != want {
		t.Errorf("ToSession() = %+v, want %+v", got, want)
	}
}

func TestNormalizeForInsert(t *testing.T) {
	// Empty payload and non-positive max attempts get the insert defaults.
	d := NormalizeForInsert(entity.Job{Type: entity.JobTypeSendMessage, PhoneNumberID: "phone-1"})
	if string(d.Payload) != "{}" {
		t.Errorf("payload = %q, want %q", d.Payload, "{}")
	}
	if d.MaxAttempts != entity.DefaultMaxAttempts {
		t.Errorf("max_attempts = %d, want %d", d.MaxAttempts, entity.DefaultMaxAttempts)
	}
	if d.IDempotencyKey != nil {
		t.Errorf("idempotency_key = %v, want nil for empty input", *d.IDempotencyKey)
	}

	// Negative max attempts are treated like zero.
	if got := NormalizeForInsert(entity.Job{MaxAttempts: -1}); got.MaxAttempts != entity.DefaultMaxAttempts {
		t.Errorf("negative max_attempts = %d, want %d", got.MaxAttempts, entity.DefaultMaxAttempts)
	}

	// Valid payload and max attempts are preserved.
	d3 := NormalizeForInsert(entity.Job{Payload: json.RawMessage(`{"to":"6281"}`), MaxAttempts: 5})
	if string(d3.Payload) != `{"to":"6281"}` {
		t.Errorf("payload = %q, want preserved", d3.Payload)
	}
	if d3.MaxAttempts != 5 {
		t.Errorf("max_attempts = %d, want 5", d3.MaxAttempts)
	}

	// Non-empty idempotency key survives the mapper.
	d4 := NormalizeForInsert(entity.Job{IDempotencyKey: "key-1"})
	if d4.IDempotencyKey == nil || *d4.IDempotencyKey != "key-1" {
		t.Errorf("idempotency_key = %v, want key-1", d4.IDempotencyKey)
	}
}

func TestDerefTime(t *testing.T) {
	now := time.Date(2026, 8, 7, 12, 0, 0, 0, time.UTC)
	if got := derefTime(nil); !got.IsZero() {
		t.Errorf("derefTime(nil) = %v, want zero time", got)
	}
	if got := derefTime(&now); !got.Equal(now) {
		t.Errorf("derefTime(&now) = %v, want %v", got, now)
	}
}

func TestDerefString(t *testing.T) {
	if got := derefString(nil); got != "" {
		t.Errorf("derefString(nil) = %q, want empty", got)
	}
	value := "value"
	if got := derefString(&value); got != "value" {
		t.Errorf("derefString(&value) = %q, want value", got)
	}
}

func TestDerefBytes(t *testing.T) {
	if got := derefBytes(nil); got != nil {
		t.Errorf("derefBytes(nil) = %v, want nil", got)
	}
	value := []byte("data")
	if got := derefBytes(&value); !bytes.Equal(got, value) {
		t.Errorf("derefBytes(&value) = %v, want %v", got, value)
	}
}
