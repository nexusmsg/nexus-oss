package queue

import (
	"context"
	"errors"
	"testing"

	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
	"github.com/jackc/pgx/v5"
)

// stubScanner mimics the Scan(dest ...any) error contract shared by *pgx.Row
// and *pgx.Rows, so scanSession can be exercised hermetically.
type stubScanner struct {
	dest  []any
	callN int
	err   error
}

func (s *stubScanner) Scan(dest ...any) error {
	if s.err != nil {
		return s.err
	}
	s.dest = dest
	s.callN++
	// Populate the string destinations like pgx would for text columns.
	values := []string{
		"phone-1",
		"628123456789",
		"+62 812-3456-789",
		"waba-1",
		domain.SessionStatusConnected,
	}
	for i, v := range values {
		if p, ok := dest[i].(*string); ok {
			*p = v
		}
	}
	return nil
}

func TestScanSession(t *testing.T) {
	stub := &stubScanner{}
	got, err := scanSession(stub)
	if err != nil {
		t.Fatalf("scanSession() error = %v", err)
	}
	if stub.callN != 1 {
		t.Fatalf("Scan called %d times, want 1", stub.callN)
	}
	want := domain.Session{
		PhoneNumberID:     "phone-1",
		Number:            "628123456789",
		DisplayPhone:      "+62 812-3456-789",
		BusinessAccountID: "waba-1",
		Status:            domain.SessionStatusConnected,
	}
	if got != want {
		t.Errorf("scanSession() = %+v, want %+v", got, want)
	}
}

func TestScanSessionReturnsError(t *testing.T) {
	boom := errors.New("boom")
	_, err := scanSession(&stubScanner{err: boom})
	if !errors.Is(err, boom) {
		t.Fatalf("scanSession() error = %v, want wrapped %v", err, boom)
	}
}

func TestScanSessionPropagatesNoRows(t *testing.T) {
	_, err := scanSession(&stubScanner{err: pgx.ErrNoRows})
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("scanSession() error = %v, want ErrNoRows", err)
	}
}

// TestScanSessionColumnOrder guards the SELECT/Scan column contract: the scan
// helper must receive 5 destinations in the exact order the queries select.
func TestScanSessionColumnOrder(t *testing.T) {
	stub := &stubScanner{}
	if _, err := scanSession(stub); err != nil {
		t.Fatalf("scanSession() error = %v", err)
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

// TestUpdateHeartbeatsEmptySliceReturnsNil proves the empty-slice early return
// happens before any query: a store with a nil pool must not be touched.
func TestUpdateHeartbeatsEmptySliceReturnsNil(t *testing.T) {
	store := &SessionStore{} // nil pool — must never be used for empty input
	if err := store.UpdateHeartbeats(context.Background(), nil); err != nil {
		t.Fatalf("UpdateHeartbeats(nil) error = %v, want nil", err)
	}
	if err := store.UpdateHeartbeats(context.Background(), []string{}); err != nil {
		t.Fatalf("UpdateHeartbeats([]) error = %v, want nil", err)
	}
}
