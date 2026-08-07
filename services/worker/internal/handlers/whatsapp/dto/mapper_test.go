package dto

import (
	"testing"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waWeb"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

// testMessageInfo returns the base message info shared by most fixtures.
func testMessageInfo() types.MessageInfo {
	return types.MessageInfo{
		ID:        "message-123",
		Timestamp: time.Unix(1700000000, 0),
		MessageSource: types.MessageSource{
			Sender: types.JID{User: "628123456789"},
		},
	}
}

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

func TestToMessageEvent(t *testing.T) {
	text := "hello"
	rowID := "row-1"

	tests := []struct {
		name string
		msg  *waE2E.Message
		want entity.MessageEventType
	}{
		{
			name: "text",
			msg:  &waE2E.Message{Conversation: &text},
			want: entity.MessageEventTypeText,
		},
		{
			name: "extended text with context",
			msg: &waE2E.Message{ExtendedTextMessage: &waE2E.ExtendedTextMessage{
				Text: &text,
				ContextInfo: &waE2E.ContextInfo{
					StanzaID:    proto.String("quoted-123"),
					Participant: proto.String("628111111111"),
				},
			}},
			want: entity.MessageEventTypeText,
		},
		{
			name: "button reply",
			msg: &waE2E.Message{ButtonsResponseMessage: &waE2E.ButtonsResponseMessage{
				SelectedButtonID: proto.String("button-1"),
				Response:         &waE2E.ButtonsResponseMessage_SelectedDisplayText{SelectedDisplayText: "Confirm"},
			}},
			want: entity.MessageEventTypeInteractive,
		},
		{
			name: "location",
			msg: &waE2E.Message{LocationMessage: &waE2E.LocationMessage{
				DegreesLatitude:  proto.Float64(-6.2),
				DegreesLongitude: proto.Float64(106.8),
			}},
			want: entity.MessageEventTypeLocation,
		},
		{
			name: "reaction",
			msg: &waE2E.Message{ReactionMessage: &waE2E.ReactionMessage{
				Key:  &waCommon.MessageKey{},
				Text: proto.String("👍"),
			}},
			want: entity.MessageEventTypeReaction,
		},
		{
			name: "list reply",
			msg: &waE2E.Message{ListResponseMessage: &waE2E.ListResponseMessage{
				Title:             proto.String("Pick one"),
				Description:       proto.String("choose below"),
				SingleSelectReply: &waE2E.ListResponseMessage_SingleSelectReply{SelectedRowID: &rowID},
			}},
			want: entity.MessageEventTypeInteractive,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			message := ToMessageEvent(&events.Message{Info: testMessageInfo(), Message: tt.msg})
			if message.Type != tt.want {
				t.Fatalf("type = %q, want %q", message.Type, tt.want)
			}
			if message.From != "628123456789" || message.ID != "message-123" || message.Timestamp != "1700000000" {
				t.Errorf("base fields = %+v", message)
			}
			switch {
			case tt.name == "extended text with context":
				if message.Text != "hello" {
					t.Errorf("text = %q, want hello", message.Text)
				}
				if message.Context == nil || message.Context.ID != "quoted-123" || message.Context.From != "628111111111" {
					t.Errorf("context = %+v", message.Context)
				}
			case tt.name == "button reply":
				if message.Interactive == nil || message.Interactive.ButtonReply == nil ||
					message.Interactive.ButtonReply.ID != "button-1" || message.Interactive.ButtonReply.Title != "Confirm" {
					t.Errorf("button reply = %+v", message.Interactive)
				}
			case tt.name == "list reply":
				if message.Interactive == nil || message.Interactive.ListReply == nil ||
					message.Interactive.ListReply.ID != "row-1" || message.Interactive.ListReply.Title != "Pick one" ||
					message.Interactive.ListReply.Description != "choose below" {
					t.Errorf("list reply = %+v", message.Interactive)
				}
			case tt.name == "location":
				if message.Location == nil || message.Location.Latitude != -6.2 || message.Location.Longitude != 106.8 {
					t.Errorf("location = %+v", message.Location)
				}
			case tt.name == "reaction":
				if message.Reaction == nil || message.Reaction.MessageID != "" || message.Reaction.Emoji != "👍" {
					t.Errorf("reaction = %+v", message.Reaction)
				}
			}
		})
	}
}

func TestToMessageEventUnsupported(t *testing.T) {
	message := ToMessageEvent(&events.Message{Info: testMessageInfo(), Message: &waE2E.Message{}})
	if message.Type != entity.MessageEventTypeUnknown {
		t.Fatalf("type = %q, want unsupported", message.Type)
	}
	if message.Text != "" || message.Location != nil || message.Reaction != nil ||
		message.Interactive != nil || len(message.Contacts) != 0 {
		t.Errorf("unsupported message = %+v", message)
	}
}

func TestPhoneChangeNumber(t *testing.T) {
	individual := waWeb.WebMessageInfo_INDIVIDUAL_CHANGE_NUMBER
	group := waWeb.WebMessageInfo_GROUP_PARTICIPANT_CHANGE_NUMBER
	subject := waWeb.WebMessageInfo_GROUP_CHANGE_SUBJECT

	tests := []struct {
		name      string
		sourceMsg *waWeb.WebMessageInfo
		wantPhone string
		wantOK    bool
	}{
		{
			name:      "individual change number",
			sourceMsg: &waWeb.WebMessageInfo{MessageStubType: &individual, MessageStubParameters: []string{"628222222222"}},
			wantPhone: "628222222222",
			wantOK:    true,
		},
		{
			name:      "group participant change number",
			sourceMsg: &waWeb.WebMessageInfo{MessageStubType: &group, MessageStubParameters: []string{"628222222222"}},
			wantPhone: "628222222222",
			wantOK:    true,
		},
		{
			name:      "non-change stub",
			sourceMsg: &waWeb.WebMessageInfo{MessageStubType: &subject, MessageStubParameters: []string{"628222222222"}},
			wantOK:    false,
		},
		{
			name:      "missing stub parameters",
			sourceMsg: &waWeb.WebMessageInfo{MessageStubType: &individual},
			wantOK:    false,
		},
		{
			name:      "empty stub parameter",
			sourceMsg: &waWeb.WebMessageInfo{MessageStubType: &individual, MessageStubParameters: []string{""}},
			wantOK:    false,
		},
		{
			name:      "no source web message",
			sourceMsg: nil,
			wantOK:    false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			phone, ok := PhoneChangeNumber(&events.Message{SourceWebMsg: tt.sourceMsg})
			if ok != tt.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tt.wantOK)
			}
			if phone != tt.wantPhone {
				t.Errorf("phone = %q, want %q", phone, tt.wantPhone)
			}
		})
	}
}

func TestToPhoneChangeEvent(t *testing.T) {
	stubType := waWeb.WebMessageInfo_INDIVIDUAL_CHANGE_NUMBER
	evt := &events.Message{
		Info: types.MessageInfo{
			ID:        "stub-123",
			Timestamp: time.Unix(1700000000, 0),
			PushName:  "Alice",
			MessageSource: types.MessageSource{
				Sender: types.JID{User: "628111111111"},
			},
		},
		SourceWebMsg: &waWeb.WebMessageInfo{
			MessageStubType:       &stubType,
			MessageStubParameters: []string{"628222222222"},
		},
	}

	got := ToPhoneChangeEvent(evt, "628222222222", "business-123", "phone-123", "+628123456789")
	if got.BusinessAccountID != "business-123" || got.PhoneNumberID != "phone-123" || got.DisplayPhoneNumber != "+628123456789" {
		t.Errorf("routing fields = %+v", got)
	}
	if got.ProfileName != "Alice" || got.WhatsAppID != "628111111111" || got.Message.From != "628111111111" {
		t.Errorf("contact fields = %+v", got)
	}
	if got.Message.ID != "stub-123" || got.Message.Timestamp != "1700000000" {
		t.Errorf("message base = %+v", got.Message)
	}
	if got.Message.Type != entity.MessageEventTypeSystem {
		t.Fatalf("type = %q, want system", got.Message.Type)
	}
	if got.Message.System == nil {
		t.Fatal("system = nil")
	}
	if got.Message.System.Type != entity.SystemEventTypeUserChangedNumber {
		t.Errorf("system.type = %q", got.Message.System.Type)
	}
	if got.Message.System.WaID != "628222222222" {
		t.Errorf("system.wa_id = %q, want new phone", got.Message.System.WaID)
	}
	if got.Message.System.Body != "User Alice changed from 628111111111 to 628222222222" {
		t.Errorf("system.body = %q", got.Message.System.Body)
	}
}

func TestToPhoneChangeEventPrefersSourcePushName(t *testing.T) {
	stubType := waWeb.WebMessageInfo_INDIVIDUAL_CHANGE_NUMBER
	evt := &events.Message{
		Info: types.MessageInfo{
			ID:        "stub-123",
			Timestamp: time.Unix(1700000000, 0),
			PushName:  "Stale",
			MessageSource: types.MessageSource{
				Sender: types.JID{User: "628111111111"},
			},
		},
		SourceWebMsg: &waWeb.WebMessageInfo{
			MessageStubType:       &stubType,
			MessageStubParameters: []string{"628222222222"},
			PushName:              proto.String("Fresh"),
		},
	}

	got := ToPhoneChangeEvent(evt, "628222222222", "", "", "")
	if got.ProfileName != "Fresh" {
		t.Errorf("ProfileName = %q, want Fresh", got.ProfileName)
	}
	if got.Message.System.Body != "User Fresh changed from 628111111111 to 628222222222" {
		t.Errorf("system.body = %q", got.Message.System.Body)
	}
}

func TestToInboundEvent(t *testing.T) {
	text := "hello"
	evt := &events.Message{
		Info: types.MessageInfo{
			ID:        "message-123",
			Timestamp: time.Unix(1700000000, 0),
			PushName:  "Alice",
			MessageSource: types.MessageSource{
				Sender: types.JID{User: "628123456789"},
			},
		},
		Message: &waE2E.Message{Conversation: &text},
	}

	got := ToInboundEvent(evt, "business-123", "phone-123", "+628123456789")
	if got.BusinessAccountID != "business-123" || got.PhoneNumberID != "phone-123" || got.DisplayPhoneNumber != "+628123456789" {
		t.Errorf("routing fields = %+v", got)
	}
	if got.ProfileName != "Alice" || got.WhatsAppID != "628123456789" || got.IsFromMe {
		t.Errorf("contact fields = %+v", got)
	}
	if got.Message.Type != entity.MessageEventTypeText || got.Message.Text != "hello" {
		t.Errorf("message = %+v", got.Message)
	}
}

func TestToContextEvent(t *testing.T) {
	tests := []struct {
		name string
		in   *waE2E.ContextInfo
		want *entity.ContextEvent
	}{
		{
			name: "nil context",
			in:   nil,
			want: nil,
		},
		{
			name: "participant with domain suffix",
			in: &waE2E.ContextInfo{
				StanzaID:    proto.String("quoted-123"),
				Participant: proto.String("628111111111@g.us"),
			},
			want: &entity.ContextEvent{ID: "quoted-123", From: "628111111111"},
		},
		{
			name: "participant without suffix",
			in: &waE2E.ContextInfo{
				StanzaID:    proto.String("quoted-123"),
				Participant: proto.String("628111111111"),
			},
			want: &entity.ContextEvent{ID: "quoted-123", From: "628111111111"},
		},
		{
			name: "empty participant",
			in: &waE2E.ContextInfo{
				StanzaID: proto.String("quoted-123"),
			},
			want: &entity.ContextEvent{ID: "quoted-123", From: ""},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ToContextEvent(tt.in)
			if tt.want == nil {
				if got != nil {
					t.Fatalf("ToContextEvent() = %+v, want nil", got)
				}
				return
			}
			if got == nil || *got != *tt.want {
				t.Errorf("ToContextEvent() = %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestToContactEvents(t *testing.T) {
	t.Run("valid vcard", func(t *testing.T) {
		got := ToContactEvents(&waE2E.ContactMessage{
			DisplayName: proto.String("John"),
			Vcard:       proto.String(testVCard),
		})
		if len(got) != 1 {
			t.Fatalf("ToContactEvents() = %d contacts, want 1", len(got))
		}
		if got[0].Name.FormattedName != "John Doe" {
			t.Errorf("FormattedName = %q, want John Doe", got[0].Name.FormattedName)
		}
		if len(got[0].Phones) != 1 || got[0].Phones[0].Phone != "+1-555-1234" {
			t.Errorf("Phones = %+v", got[0].Phones)
		}
	})

	t.Run("display name fallback when vcard has no name", func(t *testing.T) {
		got := ToContactEvents(&waE2E.ContactMessage{
			DisplayName: proto.String("NoName"),
			Vcard:       proto.String("BEGIN:VCARD\nVERSION:3.0\nEND:VCARD\n"),
		})
		if len(got) != 1 || got[0].Name.FormattedName != "NoName" {
			t.Errorf("ToContactEvents() = %+v, want display name fallback", got)
		}
	})

	t.Run("empty vcard", func(t *testing.T) {
		if got := ToContactEvents(&waE2E.ContactMessage{Vcard: proto.String("")}); got != nil {
			t.Errorf("ToContactEvents() = %+v, want nil", got)
		}
	})

	t.Run("invalid vcard", func(t *testing.T) {
		if got := ToContactEvents(&waE2E.ContactMessage{Vcard: proto.String("BEGIN:VCARD\nVERSION:4.0")}); got != nil {
			t.Errorf("ToContactEvents() = %+v, want nil", got)
		}
	})
}
