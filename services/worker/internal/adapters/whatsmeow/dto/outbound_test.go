package dto

import (
	"strings"
	"testing"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
)

func TestToWaE2EMessageText(t *testing.T) {
	got, err := ToWaE2EMessage(entity.OutboundMessage{
		To:   "628123456789",
		Text: &entity.Text{Body: "hello"},
	})
	if err != nil {
		t.Fatalf("ToWaE2EMessage() error = %v", err)
	}
	if got.GetConversation() != "hello" {
		t.Errorf("Conversation = %q, want hello", got.GetConversation())
	}
	if got.GetContactMessage() != nil || got.GetContactsArrayMessage() != nil {
		t.Errorf("unexpected contact payload = %+v", got)
	}
}

func TestToWaE2EMessageTextMissing(t *testing.T) {
	_, err := ToWaE2EMessage(entity.OutboundMessage{To: "628123456789", Type: "text"})
	if err == nil || err.Error() != "text message is missing" {
		t.Fatalf("ToWaE2EMessage() error = %v, want text message is missing", err)
	}
}

func TestToWaE2EMessageContacts(t *testing.T) {
	got, err := ToWaE2EMessage(entity.OutboundMessage{
		To:   "628123456789",
		Type: "contacts",
		Contacts: []entity.ContactInput{
			{Name: entity.NameObject{FormattedName: "John Doe"}},
		},
	})
	if err != nil {
		t.Fatalf("ToWaE2EMessage() error = %v", err)
	}
	cm := got.GetContactMessage()
	if cm == nil {
		t.Fatal("ContactMessage = nil, want single-contact message")
	}
	if cm.GetDisplayName() != "John Doe" {
		t.Errorf("DisplayName = %q, want John Doe", cm.GetDisplayName())
	}
	if !strings.Contains(cm.GetVcard(), "FN:John Doe") {
		t.Errorf("Vcard = %q, want FN:John Doe", cm.GetVcard())
	}
	if got.GetConversation() != "" {
		t.Errorf("unexpected Conversation = %q", got.GetConversation())
	}
}

func TestToWaE2EMessageContactsMissing(t *testing.T) {
	tests := []struct {
		name string
		msg  entity.OutboundMessage
	}{
		{"empty contacts", entity.OutboundMessage{To: "628123456789", Type: "contacts"}},
		{"contacts type with text but no contacts", entity.OutboundMessage{To: "628123456789", Type: "contacts", Text: &entity.Text{Body: "hello"}}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := ToWaE2EMessage(tt.msg)
			if err == nil || err.Error() != "contacts message is missing contacts" {
				t.Fatalf("ToWaE2EMessage() error = %v, want contacts message is missing contacts", err)
			}
		})
	}
}

func TestBuildContactMessageEmpty(t *testing.T) {
	if got := BuildContactMessage(nil); got != nil {
		t.Fatalf("BuildContactMessage() = %+v, want nil", got)
	}
}

func TestBuildContactMessageSingleContact(t *testing.T) {
	got := BuildContactMessage([]entity.ContactInput{
		{
			Name:   entity.NameObject{FormattedName: "John Doe"},
			Phones: []entity.PhoneObject{{Phone: "+1-555-1234"}},
		},
	})
	cm := got.GetContactMessage()
	if cm == nil {
		t.Fatal("ContactMessage = nil, want single-contact message")
	}
	if cm.GetDisplayName() != "John Doe" {
		t.Errorf("DisplayName = %q, want John Doe", cm.GetDisplayName())
	}
	if !strings.Contains(cm.GetVcard(), "+1-555-1234") {
		t.Errorf("Vcard missing phone:\n%q", cm.GetVcard())
	}
	if got.GetContactsArrayMessage() != nil {
		t.Error("unexpected ContactsArrayMessage for a single contact")
	}
}

func TestBuildContactMessageMultipleContacts(t *testing.T) {
	got := BuildContactMessage([]entity.ContactInput{
		{Name: entity.NameObject{FormattedName: "John Doe"}},
		{Name: entity.NameObject{FormattedName: "Jane Roe"}},
	})
	cam := got.GetContactsArrayMessage()
	if cam == nil {
		t.Fatal("ContactsArrayMessage = nil, want multi-contact message")
	}
	if cam.GetDisplayName() != "John Doe" {
		t.Errorf("array DisplayName = %q, want first contact name", cam.GetDisplayName())
	}
	contacts := cam.GetContacts()
	if len(contacts) != 2 {
		t.Fatalf("contacts = %d, want 2", len(contacts))
	}
	if contacts[0].GetDisplayName() != "John Doe" || contacts[1].GetDisplayName() != "Jane Roe" {
		t.Errorf("contacts = %+v", contacts)
	}
	if got.GetContactMessage() != nil {
		t.Error("unexpected ContactMessage for multiple contacts")
	}
}

func TestBuildSingleVCard(t *testing.T) {
	raw, err := BuildSingleVCard(entity.ContactInput{
		Birthday: "1990-01-01",
		Name:     entity.NameObject{FormattedName: "John Doe", FirstName: "John", LastName: "Doe"},
		Org:      entity.OrgObject{Company: "Acme Corp", Department: "Engineering", Title: "Engineer"},
		Phones:   []entity.PhoneObject{{Phone: "+1-555-1234", Type: "WORK", WaID: "628123456789"}},
		Emails:   []entity.EmailObject{{Email: "john@example.com", Type: "WORK"}},
		URLs:     []entity.URLObject{{URL: "https://example.com", Type: "WORK"}},
	})
	if err != nil {
		t.Fatalf("BuildSingleVCard() error = %v", err)
	}
	for _, want := range []string{
		"BEGIN:VCARD",
		"VERSION:3.0",
		"FN:John Doe",
		"N:Doe;John;;;",
		"+1-555-1234",
		"john@example.com",
		"Acme Corp",
		"Engineering",
		"TITLE:Engineer",
		"BDAY:1990-01-01",
		"https://example.com",
		"END:VCARD",
	} {
		if !strings.Contains(raw, want) {
			t.Errorf("vCard missing %q:\n%s", want, raw)
		}
	}
}
