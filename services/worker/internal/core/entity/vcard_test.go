package entity

import (
	"strings"
	"testing"
)

// testVCard is a vCard 3.0 string exercising every field ParseVCard maps.
const testVCard = `BEGIN:VCARD
VERSION:3.0
FN:John Doe
N:Doe;John;Q.;Dr.;PhD
TEL;TYPE=WORK:+1-555-1234
EMAIL;TYPE=INTERNET:john@example.com
ORG:Acme Corp;Engineering
TITLE:Engineer
BDAY:19900101
URL:https://example.com
END:VCARD
`

func TestParseVCard(t *testing.T) {
	evt, err := ParseVCard(testVCard)
	if err != nil {
		t.Fatalf("ParseVCard() error = %v", err)
	}
	if evt.Name.FormattedName != "John Doe" {
		t.Errorf("FormattedName = %q, want John Doe", evt.Name.FormattedName)
	}
	if evt.Name.FirstName != "John" || evt.Name.LastName != "Doe" || evt.Name.MiddleName != "Q." {
		t.Errorf("Name = %+v, want Doe;John;Q.", evt.Name)
	}
	if len(evt.Phones) != 1 || evt.Phones[0].Phone != "+1-555-1234" || evt.Phones[0].Type != "WORK" {
		t.Errorf("Phones = %+v", evt.Phones)
	}
	if len(evt.Emails) != 1 || evt.Emails[0].Email != "john@example.com" || evt.Emails[0].Type != "INTERNET" {
		t.Errorf("Emails = %+v", evt.Emails)
	}
	if evt.Org.Company != "Acme Corp" || evt.Org.Department != "Engineering" || evt.Org.Title != "Engineer" {
		t.Errorf("Org = %+v", evt.Org)
	}
	if evt.Birthday != "1990-01-01" {
		t.Errorf("Birthday = %q, want 1990-01-01", evt.Birthday)
	}
	if len(evt.URLs) != 1 || evt.URLs[0].URL != "https://example.com" {
		t.Errorf("URLs = %+v", evt.URLs)
	}
}

func TestBuildVCardRoundTrip(t *testing.T) {
	original := ContactEvent{
		Name: NameEvent{FormattedName: "Jane Roe", FirstName: "Jane", LastName: "Roe"},
		Phones: []PhoneEvent{
			{Phone: "+1-555-9999", Type: "HOME"},
			{Phone: "+1-555-0000", Type: "WORK"},
		},
		Emails: []EmailEvent{{Email: "jane@example.com", Type: "HOME"}},
		Org:    OrganizationEvent{Company: "Acme Corp", Department: "Sales", Title: "Manager"},
	}

	raw, err := BuildVCard(original)
	if err != nil {
		t.Fatalf("BuildVCard() error = %v", err)
	}
	for _, want := range []string{"BEGIN:VCARD", "VERSION:3.0", "FN:Jane Roe", "N:Roe;Jane;;;", "+1-555-9999", "+1-555-0000", "jane@example.com", "Acme Corp", "END:VCARD"} {
		if !strings.Contains(raw, want) {
			t.Errorf("built vCard missing %q:\n%s", want, raw)
		}
	}

	evt, err := ParseVCard(raw)
	if err != nil {
		t.Fatalf("ParseVCard() error = %v", err)
	}
	if evt.Name.FormattedName != "Jane Roe" || evt.Name.FirstName != "Jane" || evt.Name.LastName != "Roe" {
		t.Errorf("Name = %+v, want Jane Roe", evt.Name)
	}
	if len(evt.Phones) != 2 {
		t.Errorf("Phones = %+v, want 2", evt.Phones)
	}
	if len(evt.Emails) != 1 || evt.Emails[0].Email != "jane@example.com" {
		t.Errorf("Emails = %+v", evt.Emails)
	}
	if evt.Org.Company != "Acme Corp" || evt.Org.Department != "Sales" || evt.Org.Title != "Manager" {
		t.Errorf("Org = %+v", evt.Org)
	}
}

func TestParseVCardRejectsInvalidInput(t *testing.T) {
	if _, err := ParseVCard(""); err == nil || !strings.Contains(err.Error(), "empty input") {
		t.Fatalf("ParseVCard(\"\") error = %v, want empty input error", err)
	}
	// A card without an END line is malformed.
	if _, err := ParseVCard("BEGIN:VCARD\nVERSION:4.0"); err == nil {
		t.Fatal("ParseVCard(malformed) returned nil error")
	}
}
