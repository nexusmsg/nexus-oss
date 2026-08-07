package dto

import (
	"encoding/json"
	"testing"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
)

// TestFromEntityPreservesNilVsEmpty locks in the mapper contract: the
// non-omitempty Entry/Changes slices must stay nil when the source is nil (so
// the wire JSON renders "entry":null) and must become non-nil empty slices
// when the source is an explicit empty slice (so the wire JSON renders
// "entry":[]).
func TestFromEntityPreservesNilVsEmpty(t *testing.T) {
	emptyEntry := []entity.Entry{}
	emptyChanges := []entity.Change{}

	cases := []struct {
		name         string
		input        entity.WebhookPayload
		wantEntryNil bool
		wantEntryLen int
		wantChgNil   bool // applies to the first entry's Changes
		wantChgLen   int
	}{
		{
			name:         "zero value keeps entry nil",
			input:        entity.WebhookPayload{},
			wantEntryNil: true,
		},
		{
			name:         "explicit empty entry stays non-nil",
			input:        entity.WebhookPayload{Object: "whatsapp_business_account", Entry: emptyEntry},
			wantEntryNil: false,
			wantEntryLen: 0,
		},
		{
			name: "entry with change keeps changes nil",
			input: entity.WebhookPayload{
				Object: "whatsapp_business_account",
				Entry:  []entity.Entry{{ID: "entry-1"}},
			},
			wantEntryNil: false,
			wantEntryLen: 1,
			wantChgNil:   true,
		},
		{
			name: "explicit empty changes stay non-nil",
			input: entity.WebhookPayload{
				Object: "whatsapp_business_account",
				Entry:  []entity.Entry{{ID: "entry-1", Changes: emptyChanges}},
			},
			wantEntryNil: false,
			wantEntryLen: 1,
			wantChgNil:   false,
			wantChgLen:   0,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := FromEntity(tc.input)
			if err != nil {
				t.Fatalf("FromEntity() error = %v", err)
			}
			if (got.Entry == nil) != tc.wantEntryNil {
				t.Errorf("Entry nil = %v, want %v", got.Entry == nil, tc.wantEntryNil)
			}
			if got.Entry != nil && len(got.Entry) != tc.wantEntryLen {
				t.Errorf("len(Entry) = %d, want %d", len(got.Entry), tc.wantEntryLen)
			}
			if len(got.Entry) == 1 {
				ch := got.Entry[0].Changes
				if (ch == nil) != tc.wantChgNil {
					t.Errorf("first Entry Changes nil = %v, want %v", ch == nil, tc.wantChgNil)
				}
				if ch != nil && len(ch) != tc.wantChgLen {
					t.Errorf("len(first Entry Changes) = %d, want %d", len(ch), tc.wantChgLen)
				}
			}
		})
	}
}

// TestFromEntityMatchesEntityJSONByteForByte locks in the mapper's contract
// that marshaling the DTO produces bytes identical to marshaling the entity
// directly, across every message and contact field.
func TestFromEntityMatchesEntityJSONByteForByte(t *testing.T) {
	payload := testWebhookPayload()

	got, err := FromEntity(payload)
	if err != nil {
		t.Fatalf("FromEntity() error = %v", err)
	}

	want, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("Marshal(entity) error = %v", err)
	}
	gotJSON, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("Marshal(dto) error = %v", err)
	}
	if string(gotJSON) != string(want) {
		t.Errorf("dto JSON != entity JSON:\ndto:    %s\nentity: %s", gotJSON, want)
	}
}

// TestFromEntityMapsFullStructure verifies field-level mapping of a payload
// that exercises every message variant and contact sub-object.
func TestFromEntityMapsFullStructure(t *testing.T) {
	got, err := FromEntity(testWebhookPayload())
	if err != nil {
		t.Fatalf("FromEntity() error = %v", err)
	}

	entry := got.Entry[0]
	if entry.ID != "entry-1" || len(entry.Changes) != 1 {
		t.Fatalf("entry = %+v", entry)
	}
	value := entry.Changes[0].Value
	if entry.Changes[0].Field != "messages" {
		t.Errorf("field = %q, want messages", entry.Changes[0].Field)
	}
	if value.MessagingProduct != "whatsapp" || value.Metadata.DisplayPhoneNumber != "16505551111" || value.Metadata.PhoneNumberID != "phone-1" {
		t.Errorf("value metadata = %+v", value.Metadata)
	}
	if len(value.Contacts) != 1 || value.Contacts[0].WaID != "6281234567890" || value.Contacts[0].Profile.Name != "Aziz Fikri" {
		t.Errorf("contacts = %+v", value.Contacts)
	}
	if len(value.Messages) != 7 {
		t.Fatalf("len(Messages) = %d, want 7", len(value.Messages))
	}
	if len(value.Statuses) != 1 || value.Statuses[0].Status != "read" {
		t.Errorf("statuses = %+v", value.Statuses)
	}
}

// testWebhookPayload returns a payload exercising every mapper branch.
func testWebhookPayload() entity.WebhookPayload {
	text := entity.Message{
		From:      "6281234567890",
		ID:        "wamid-text",
		Timestamp: "1723000000",
		Type:      "text",
		Text:      &entity.Text{Body: "hello world"},
	}
	location := entity.Message{
		From:      "6281234567890",
		ID:        "wamid-loc",
		Timestamp: "1723000001",
		Type:      "location",
		Location:  &entity.Location{Latitude: -6.2, Longitude: 106.8, Name: "Jakarta", Address: "Jl. Sudirman"},
	}
	reaction := entity.Message{
		From:      "6281234567890",
		ID:        "wamid-rx",
		Timestamp: "1723000002",
		Type:      "reaction",
		Reaction:  &entity.Reaction{MessageID: "wamid-text", Emoji: "\u2764\ufe0f"},
	}
	interactive := entity.Message{
		From:      "6281234567890",
		ID:        "wamid-int",
		Timestamp: "1723000003",
		Type:      "interactive",
		Interactive: &entity.Interactive{
			Type:        "button_reply",
			ButtonReply: &entity.ButtonReply{ID: "btn-1", Title: "Yes"},
			ListReply:   &entity.ListReply{ID: "row-1", Title: "Option", Description: "desc"},
		},
	}
	contactMsg := entity.Message{
		From:      "6281234567890",
		ID:        "wamid-cnt",
		Timestamp: "1723000004",
		Type:      "contacts",
		Contacts: []entity.ContactObject{
			{
				Birthday: "1990-01-01",
				Name: entity.NameObject{
					FormattedName: "Aziz Fikri",
					FirstName:     "Aziz",
					LastName:      "Fikri",
					MiddleName:    "M",
					Prefix:        "Mr",
					Suffix:        "Jr",
				},
				Org: entity.OrgObject{Company: "ACME", Department: "Eng", Title: "Engineer"},
				Addresses: []entity.AddressObject{
					{Street: "Jl. Sudirman", City: "Jakarta", State: "DKI", Zip: "12345", Country: "ID", CountryCode: "ID"},
				},
				Emails: []entity.EmailObject{{Email: "aziz@acme.dev", Type: "WORK"}},
				Phones: []entity.PhoneObject{{Phone: "+6281234567890", Type: "MOBILE", WaID: "6281234567890"}},
				URLs:   []entity.URLObject{{URL: "https://acme.dev/aziz", Type: "WORK"}},
			},
		},
	}
	system := entity.Message{
		From:      "6281234567890",
		ID:        "wamid-sys",
		Timestamp: "1723000005",
		Type:      "system",
		System:    &entity.SystemMessage{Body: "changed number", WaID: "6281234567890", Type: "user_changed_number"},
	}
	contextual := entity.Message{
		From:      "6281234567890",
		ID:        "wamid-ctx",
		Timestamp: "1723000006",
		Type:      "text",
		Text:      &entity.Text{Body: "reply"},
		Context:   &entity.MessageContext{ID: "wamid-text", From: "16505551111"},
	}

	return entity.WebhookPayload{
		Object: "whatsapp_business_account",
		Entry: []entity.Entry{
			{
				ID: "entry-1",
				Changes: []entity.Change{
					{
						Field: "messages",
						Value: entity.Value{
							MessagingProduct: "whatsapp",
							Metadata:         entity.Metadata{DisplayPhoneNumber: "16505551111", PhoneNumberID: "phone-1"},
							Contacts: []entity.Contact{
								{Profile: entity.Profile{Name: "Aziz Fikri"}, WaID: "6281234567890"},
							},
							Messages: []entity.Message{text, location, reaction, interactive, contactMsg, system, contextual},
							Statuses: []entity.Status{
								{ID: "wamid-status", Status: "read", Timestamp: "1723000007", RecipientID: "6281234567890"},
							},
						},
					},
				},
			},
		},
	}
}

// TestComputeHMAC checks the hex output against precomputed HMAC-SHA256
// vectors. The coverage previously lived in the webhook adapter client test.
func TestComputeHMAC(t *testing.T) {
	cases := []struct {
		name   string
		secret string
		body   string
		want   string
	}{
		{
			name:   "webhook body vector",
			secret: "test-secret",
			body:   `{"object":"whatsapp_business_account","entry":null}`,
			want:   "1ba60c99e6d000ca783787866004a0c89b75e3f88f099b1b0f5ca95a1f14a552",
		},
		{
			name:   "empty entry array",
			secret: "s3cret",
			body:   `{"entry":[]}`,
			want:   "55e94cedb4167d0e4e8c20f779a70292819e38da2afea51bf02dc6ecc52542ba",
		},
		{
			name:   "empty secret and body",
			secret: "",
			body:   "",
			want:   "b613679a0814d9ec772f95d778c35fc5ff1697c493715653c6c712144292c5ad",
		},
		{
			name:   "empty body",
			secret: "secret",
			body:   "",
			want:   "f9e66e179b6747ae54108f82f8ade8b3c25d76fd30afde6c395822c530196169",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ComputeHMAC(tc.secret, []byte(tc.body)); got != tc.want {
				t.Errorf("ComputeHMAC() = %q, want %q", got, tc.want)
			}
		})
	}
}
