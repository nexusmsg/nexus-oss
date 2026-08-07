// Package dto maps whatsmeow driver types to the entity event model. It is
// pure translation: no I/O, no logging, no business rules. The whatsapp
// handler calls these mappers and delegates the resulting entity to the
// application service.
package dto

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waWeb"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

// ToInboundEvent maps an unwrapped whatsmeow message into an inbound event,
// annotating it with the adapter's routing configuration.
func ToInboundEvent(evt *events.Message, businessAccountID, phoneNumberID, displayPhone string) entity.InboundEvent {
	return entity.InboundEvent{
		BusinessAccountID:  businessAccountID,
		IsFromMe:           evt.Info.IsFromMe,
		DisplayPhoneNumber: displayPhone,
		PhoneNumberID:      phoneNumberID,
		ProfileName:        evt.Info.PushName,
		WhatsAppID:         evt.Info.Sender.User,
		Message:            ToMessageEvent(evt),
	}
}

// ToPhoneChangeEvent maps a number-change stub message into a WABA system
// message event. newPhone comes from SourceWebMsg.MessageStubParameters.
func ToPhoneChangeEvent(evt *events.Message, newPhone, businessAccountID, phoneNumberID, displayPhone string) entity.InboundEvent {
	oldPhone := evt.Info.Sender.User
	pushName := evt.Info.PushName
	if pn := evt.SourceWebMsg.GetPushName(); pn != "" {
		pushName = pn
	}

	return entity.InboundEvent{
		BusinessAccountID:  businessAccountID,
		IsFromMe:           evt.Info.IsFromMe,
		DisplayPhoneNumber: displayPhone,
		PhoneNumberID:      phoneNumberID,
		ProfileName:        pushName,
		WhatsAppID:         oldPhone,
		Message: entity.MessageEvent{
			From:      oldPhone,
			ID:        string(evt.Info.ID),
			Timestamp: strconv.FormatInt(evt.Info.Timestamp.Unix(), 10),
			Type:      entity.MessageEventTypeSystem,
			System: &entity.SystemEvent{
				Type: entity.SystemEventTypeUserChangedNumber,
				Body: fmt.Sprintf("User %s changed from %s to %s", pushName, oldPhone, newPhone),
				WaID: newPhone,
			},
		},
	}
}

// PhoneChangeNumber reports the replacement number when evt is a number-change
// stub message that carries one. SourceWebMsg is dropped by UnwrapRaw for stub
// messages, so callers must detect this before unwrapping.
func PhoneChangeNumber(evt *events.Message) (newPhone string, ok bool) {
	if evt.SourceWebMsg == nil {
		return "", false
	}
	stubType := evt.SourceWebMsg.GetMessageStubType()
	if stubType != waWeb.WebMessageInfo_INDIVIDUAL_CHANGE_NUMBER &&
		stubType != waWeb.WebMessageInfo_GROUP_PARTICIPANT_CHANGE_NUMBER {
		return "", false
	}
	params := evt.SourceWebMsg.GetMessageStubParameters()
	if len(params) == 0 || params[0] == "" {
		return "", false
	}
	return params[0], true
}

// ToMessageEvent maps a whatsmeow message into the entity message model.
func ToMessageEvent(evt *events.Message) entity.MessageEvent {
	message := entity.MessageEvent{
		From:      evt.Info.Sender.User,
		ID:        string(evt.Info.ID),
		Timestamp: strconv.FormatInt(evt.Info.Timestamp.Unix(), 10),
		Type:      entity.MessageEventTypeUnknown,
	}

	if text := evt.Message.GetConversation(); text != "" {
		message.Type = entity.MessageEventTypeText
		message.Text = text
		return message
	}
	if text := evt.Message.GetExtendedTextMessage(); text != nil {
		message.Type = entity.MessageEventTypeText
		message.Text = text.GetText()
		message.Context = ToContextEvent(text.GetContextInfo())

		return message
	}
	if location := evt.Message.GetLocationMessage(); location != nil {
		message.Type = entity.MessageEventTypeLocation
		message.Location = &entity.LocationEvent{
			Latitude:  location.GetDegreesLatitude(),
			Longitude: location.GetDegreesLongitude(),
			Name:      location.GetName(),
			Address:   location.GetAddress(),
		}
		message.Context = ToContextEvent(location.GetContextInfo())
		return message
	}
	if reaction := evt.Message.GetReactionMessage(); reaction != nil {
		message.Type = entity.MessageEventTypeReaction
		message.Reaction = &entity.ReactionEvent{
			MessageID: reaction.GetKey().GetID(),
			Emoji:     reaction.GetText(),
		}
		return message
	}
	if buttons := evt.Message.GetButtonsResponseMessage(); buttons != nil {
		message.Type = entity.MessageEventTypeInteractive
		message.Interactive = &entity.InteractiveEvent{
			Type: "button_reply",
			ButtonReply: &entity.ButtonReplyEvent{
				ID:    buttons.GetSelectedButtonID(),
				Title: buttons.GetSelectedDisplayText(),
			},
		}
		message.Context = ToContextEvent(buttons.GetContextInfo())
		return message
	}
	if list := evt.Message.GetListResponseMessage(); list != nil {
		message.Type = entity.MessageEventTypeInteractive
		message.Interactive = &entity.InteractiveEvent{
			Type: "list_reply",
		}
		if reply := list.GetSingleSelectReply(); reply != nil {
			message.Interactive.ListReply = &entity.ListReplyEvent{
				ID:          reply.GetSelectedRowID(),
				Title:       list.GetTitle(),
				Description: list.GetDescription(),
			}
		}
		message.Context = ToContextEvent(list.GetContextInfo())
		return message
	}
	if contact := evt.Message.GetContactMessage(); contact != nil {
		message.Type = entity.MessageEventTypeContacts
		message.Contacts = ToContactEvents(contact)
		return message
	}
	if contactsArray := evt.Message.GetContactsArrayMessage(); contactsArray != nil {
		message.Type = entity.MessageEventTypeContacts
		for _, c := range contactsArray.GetContacts() {
			message.Contacts = append(message.Contacts, ToContactEvents(c)...)
		}
		return message
	}

	return message
}

// ToContextEvent maps whatsmeow context info into entity context.
func ToContextEvent(contextInfo *waE2E.ContextInfo) *entity.ContextEvent {
	if contextInfo == nil {
		return nil
	}
	from := contextInfo.GetParticipant()
	if strings.Contains(from, "@") {
		parsed, err := types.ParseJID(from)
		if err != nil {
			from = ""
		} else {
			from = parsed.User
		}
	}
	return &entity.ContextEvent{
		ID:   contextInfo.GetStanzaID(),
		From: from,
	}
}

// ToContactEvents maps a whatsmeow contact message into entity contact events.
func ToContactEvents(contact *waE2E.ContactMessage) []entity.ContactEvent {
	vcardStr := contact.GetVcard()
	if vcardStr == "" {
		return nil
	}
	evt, err := entity.ParseVCard(vcardStr)
	if err != nil {
		// If parsing fails, return empty — message type stays "contacts"
		// but contacts array will be empty so downstream can still log it.
		return nil
	}
	// If vCard has no name but ContactMessage has DisplayName, use it
	if evt.Name.FormattedName == "" && contact.GetDisplayName() != "" {
		evt.Name.FormattedName = contact.GetDisplayName()
	}
	return []entity.ContactEvent{evt}
}
