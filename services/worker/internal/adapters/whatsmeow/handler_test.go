package whatsmeow

import (
	"testing"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

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
