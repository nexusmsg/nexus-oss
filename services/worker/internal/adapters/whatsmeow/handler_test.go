package whatsmeow

import (
	"context"
	"log"
	"testing"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waWeb"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

type fakeMessageService struct {
	events []*domain.InboundEvent
	err    error
}

func (f *fakeMessageService) Inbound(_ context.Context, evt *domain.InboundEvent) error {
	if f.err != nil {
		return f.err
	}
	f.events = append(f.events, evt)
	return nil
}

func TestMapMessage(t *testing.T) {
	text := "hello"
	rowID := "row-1"

	tests := []struct {
		name string
		msg  *waE2E.Message
		want domain.MessageEventType
	}{
		{
			name: "text",
			msg:  &waE2E.Message{Conversation: &text},
			want: domain.MessageEventTypeText,
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
			want: domain.MessageEventTypeText,
		},
		{
			name: "button reply",
			msg: &waE2E.Message{ButtonsResponseMessage: &waE2E.ButtonsResponseMessage{
				SelectedButtonID: proto.String("button-1"),
				Response:         &waE2E.ButtonsResponseMessage_SelectedDisplayText{SelectedDisplayText: "Confirm"},
			}},
			want: domain.MessageEventTypeInteractive,
		},
		{
			name: "location",
			msg: &waE2E.Message{LocationMessage: &waE2E.LocationMessage{
				DegreesLatitude:  proto.Float64(-6.2),
				DegreesLongitude: proto.Float64(106.8),
			}},
			want: domain.MessageEventTypeLocation,
		},
		{
			name: "reaction",
			msg: &waE2E.Message{ReactionMessage: &waE2E.ReactionMessage{
				Key:  &waCommon.MessageKey{},
				Text: proto.String("👍"),
			}},
			want: domain.MessageEventTypeReaction,
		},
		{
			name: "list reply",
			msg: &waE2E.Message{ListResponseMessage: &waE2E.ListResponseMessage{
				SingleSelectReply: &waE2E.ListResponseMessage_SingleSelectReply{SelectedRowID: &rowID},
			}},
			want: domain.MessageEventTypeInteractive,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			message := mapMessage(&events.Message{
				Info: types.MessageInfo{
					ID:        "message-123",
					Timestamp: time.Unix(1700000000, 0),
					MessageSource: types.MessageSource{
						Sender: types.JID{User: "628123456789"},
					},
				},
				Message: tt.msg,
			})
			if message.Type != tt.want {
				t.Fatalf("type = %q, want %q", message.Type, tt.want)
			}
			if message.From != "628123456789" || message.Timestamp != "1700000000" {
				t.Errorf("base fields = %+v", message)
			}
			if tt.name == "extended text with context" {
				if message.Context == nil || message.Context.ID != "quoted-123" || message.Context.From != "628111111111" {
					t.Errorf("context = %+v", message.Context)
				}
			}
			if tt.name == "button reply" {
				if message.Interactive == nil || message.Interactive.ButtonReply == nil || message.Interactive.ButtonReply.ID != "button-1" {
					t.Errorf("button reply = %+v", message.Interactive)
				}
			}
		})
	}

}

func TestHandlerDetectsNumberChangeStub(t *testing.T) {
	tests := []struct {
		name     string
		stubType waWeb.WebMessageInfo_StubType
	}{
		{name: "individual", stubType: waWeb.WebMessageInfo_INDIVIDUAL_CHANGE_NUMBER},
		{name: "group", stubType: waWeb.WebMessageInfo_GROUP_PARTICIPANT_CHANGE_NUMBER},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := &fakeMessageService{}
			handler := NewHandler(svc, "business-123", "phone-123", "+628123456789", log.Default())

			handler.Handle(context.Background())(&events.Message{
				Info: types.MessageInfo{
					ID:        "stub-123",
					Timestamp: time.Unix(1700000000, 0),
					PushName:  "Alice",
					MessageSource: types.MessageSource{
						Sender: types.JID{User: "628111111111"},
					},
				},
				SourceWebMsg: &waWeb.WebMessageInfo{
					MessageStubType:       &tt.stubType,
					MessageStubParameters: []string{"628222222222"},
				},
			})

			if len(svc.events) != 1 {
				t.Fatalf("Inbound calls = %d, want 1", len(svc.events))
			}
			evt := svc.events[0]
			if evt.Message.Type != domain.MessageEventTypeSystem {
				t.Fatalf("type = %q, want system", evt.Message.Type)
			}
			if evt.Message.System == nil {
				t.Fatal("system = nil")
			}
			if evt.Message.System.Type != domain.SystemEventTypeUserChangedNumber {
				t.Errorf("system.type = %q", evt.Message.System.Type)
			}
			if evt.Message.System.WaID != "628222222222" {
				t.Errorf("system.wa_id = %q, want new phone", evt.Message.System.WaID)
			}
			if evt.Message.System.Body != "User Alice changed from 628111111111 to 628222222222" {
				t.Errorf("system.body = %q", evt.Message.System.Body)
			}
			if evt.Message.From != "628111111111" {
				t.Errorf("from = %q, want old phone", evt.Message.From)
			}
			if evt.ProfileName != "Alice" || evt.WhatsAppID != "628111111111" {
				t.Errorf("contact = %+v", evt)
			}
		})
	}
}

func TestHandlerIgnoresChangeNumberStubWithoutNewNumber(t *testing.T) {
	svc := &fakeMessageService{}
	handler := NewHandler(svc, "", "", "", log.Default())

	stubType := waWeb.WebMessageInfo_INDIVIDUAL_CHANGE_NUMBER
	handler.Handle(context.Background())(&events.Message{
		Info: types.MessageInfo{
			ID: "stub-123",
			MessageSource: types.MessageSource{
				Sender: types.JID{User: "628111111111"},
			},
		},
		SourceWebMsg: &waWeb.WebMessageInfo{
			MessageStubType: &stubType,
		},
	})

	if len(svc.events) != 0 {
		t.Fatalf("Inbound calls = %d, want 0", len(svc.events))
	}
}

func TestHandlerTreatsNonChangeStubAsRegularMessage(t *testing.T) {
	svc := &fakeMessageService{}
	handler := NewHandler(svc, "", "", "", log.Default())

	text := "hello"
	stubType := waWeb.WebMessageInfo_GROUP_CHANGE_SUBJECT
	raw := &waE2E.Message{Conversation: &text}
	handler.Handle(context.Background())(&events.Message{
		Info: types.MessageInfo{
			ID: "msg-123",
			MessageSource: types.MessageSource{
				Sender: types.JID{User: "628111111111"},
			},
		},
		SourceWebMsg: &waWeb.WebMessageInfo{
			MessageStubType: &stubType,
		},
		Message:    raw,
		RawMessage: raw,
	})

	if len(svc.events) != 1 {
		t.Fatalf("Inbound calls = %d, want 1", len(svc.events))
	}
	if svc.events[0].Message.Type != domain.MessageEventTypeText {
		t.Fatalf("type = %q, want text", svc.events[0].Message.Type)
	}
}
