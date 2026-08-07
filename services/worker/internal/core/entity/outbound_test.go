package entity

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestOutboundMessageJSONRoundTrip(t *testing.T) {
	ttl := 600
	original := OutboundMessage{
		MessagingProduct: "whatsapp",
		To:               "628123456789",
		Type:             "text",
		Category:         "utility",
		TTL:              &ttl,
		Text:             &Text{Body: "hello"},
	}
	data, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	var decoded OutboundMessage
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}
	reencoded, err := json.Marshal(decoded)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	if string(data) != string(reencoded) {
		t.Errorf("round trip changed the payload:\n%s\n%s", data, reencoded)
	}
	if decoded.Type != "text" || decoded.Text == nil || decoded.Text.Body != "hello" || decoded.TTL == nil || *decoded.TTL != ttl {
		t.Errorf("decoded = %+v", decoded)
	}
}

// JobResult is the persisted-result contract (json-tagged), so it must
// round-trip through JSON. Job itself has no JSON tags and is not part of the
// wire contract.
func TestJobResultJSONRoundTrip(t *testing.T) {
	data, err := json.Marshal(JobResult{WA_MESSAGE_ID: "wamid-123"})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	if string(data) != `{"wa_message_id":"wamid-123"}` {
		t.Errorf("Marshal() = %s, want {\"wa_message_id\":\"wamid-123\"}", data)
	}
	var decoded JobResult
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}
	if decoded.WA_MESSAGE_ID != "wamid-123" {
		t.Errorf("decoded = %+v, want wamid-123", decoded)
	}
}

func TestValidationErrorCarriesMessage(t *testing.T) {
	err := NewValidationError("to is required")
	if err == nil || !strings.Contains(err.Error(), "to is required") {
		t.Fatalf("NewValidationError() error = %v", err)
	}
	var validationErr *ValidationError
	if !errors.As(err, &validationErr) {
		t.Errorf("error = %v, want *ValidationError", err)
	}
	if validationErr.Message != "to is required" {
		t.Errorf("Message = %q, want to is required", validationErr.Message)
	}
}
