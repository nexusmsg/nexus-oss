package whatsmeow

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"strings"

	"github.com/afikrim/waba-api-unofficial/internal/adapters/vcard"
	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waWeb"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

// Handler translates whatsmeow events and delegates inbound processing to the
// application service. It contains no webhook or business logic.
type Handler struct {
	messageService    ports.MessageService
	businessAccountID string
	phoneNumberID     string
	displayPhone      string
	logger            *log.Logger
}

func NewHandler(messageService ports.MessageService, businessAccountID, phoneNumberID, displayPhone string, logger *log.Logger) *Handler {
	if logger == nil {
		logger = log.Default()
	}
	return &Handler{
		messageService:    messageService,
		businessAccountID: businessAccountID,
		phoneNumberID:     phoneNumberID,
		displayPhone:      displayPhone,
		logger:            logger,
	}
}

func (h *Handler) Handle(ctx context.Context) func(evt any) {
	return func(evt any) {
		switch evt := evt.(type) {
		case *events.Message:
			h.handleMessage(ctx, evt)
		}
	}
}

func (h *Handler) handleMessage(ctx context.Context, evt *events.Message) {
	if evt == nil {
		return
	}
	h.logger.Printf(
		"received incoming WhatsMeow message: id=%s from=%s type=%s from_me=%t",
		evt.Info.ID,
		evt.Info.Sender.User,
		evt.Info.Type,
		evt.Info.IsFromMe,
	)
	if h.messageService == nil {
		return
	}

	// SourceWebMsg is dropped by UnwrapRaw for stub messages, so detect phone
	// number changes before unwrapping.
	if evt.SourceWebMsg != nil {
		stubType := evt.SourceWebMsg.GetMessageStubType()
		if stubType == waWeb.WebMessageInfo_INDIVIDUAL_CHANGE_NUMBER ||
			stubType == waWeb.WebMessageInfo_GROUP_PARTICIPANT_CHANGE_NUMBER {
			params := evt.SourceWebMsg.GetMessageStubParameters()
			if len(params) > 0 && params[0] != "" {
				h.handlePhoneChange(ctx, evt, params[0])
				return
			}
		}
	}

	evt = evt.UnwrapRaw()
	if evt == nil || evt.Message == nil {
		return
	}

	event := domain.InboundEvent{
		BusinessAccountID:  h.businessAccountID,
		IsFromMe:           evt.Info.IsFromMe,
		DisplayPhoneNumber: h.displayPhone,
		PhoneNumberID:      h.phoneNumberID,
		ProfileName:        evt.Info.PushName,
		WhatsAppID:         evt.Info.Sender.User,
		Message:            mapMessage(evt),
	}
	err := h.messageService.Inbound(ctx, &event)
	if err != nil {
		h.logger.Printf("handle inbound message: %v", err)
	}
}

// handlePhoneChange translates a number-change stub message into a WABA
// system message event. newPhone comes from SourceWebMsg.MessageStubParameters.
func (h *Handler) handlePhoneChange(ctx context.Context, evt *events.Message, newPhone string) {
	oldPhone := evt.Info.Sender.User
	pushName := evt.Info.PushName
	if pn := evt.SourceWebMsg.GetPushName(); pn != "" {
		pushName = pn
	}

	event := domain.InboundEvent{
		BusinessAccountID:  h.businessAccountID,
		IsFromMe:           evt.Info.IsFromMe,
		DisplayPhoneNumber: h.displayPhone,
		PhoneNumberID:      h.phoneNumberID,
		ProfileName:        pushName,
		WhatsAppID:         oldPhone,
		Message: domain.MessageEvent{
			From:      oldPhone,
			ID:        string(evt.Info.ID),
			Timestamp: strconv.FormatInt(evt.Info.Timestamp.Unix(), 10),
			Type:      domain.MessageEventTypeSystem,
			System: &domain.SystemEvent{
				Type: domain.SystemEventTypeUserChangedNumber,
				Body: fmt.Sprintf("User %s changed from %s to %s", pushName, oldPhone, newPhone),
				WaID: newPhone,
			},
		},
	}
	if err := h.messageService.Inbound(ctx, &event); err != nil {
		h.logger.Printf("handle phone change: %v", err)
	}
}

func mapMessage(evt *events.Message) domain.MessageEvent {
	message := domain.MessageEvent{
		From:      evt.Info.Sender.User,
		ID:        string(evt.Info.ID),
		Timestamp: strconv.FormatInt(evt.Info.Timestamp.Unix(), 10),
		Type:      domain.MessageEventTypeUnknown,
	}

	if text := evt.Message.GetConversation(); text != "" {
		message.Type = domain.MessageEventTypeText
		message.Text = text
		return message
	}
	if text := evt.Message.GetExtendedTextMessage(); text != nil {
		message.Type = domain.MessageEventTypeText
		message.Text = text.GetText()
		message.Context = mapContext(text.GetContextInfo())

		return message
	}
	if location := evt.Message.GetLocationMessage(); location != nil {
		message.Type = domain.MessageEventTypeLocation
		message.Location = &domain.LocationEvent{
			Latitude:  location.GetDegreesLatitude(),
			Longitude: location.GetDegreesLongitude(),
			Name:      location.GetName(),
			Address:   location.GetAddress(),
		}
		message.Context = mapContext(location.GetContextInfo())
		return message
	}
	if reaction := evt.Message.GetReactionMessage(); reaction != nil {
		message.Type = domain.MessageEventTypeReaction
		message.Reaction = &domain.ReactionEvent{
			MessageID: reaction.GetKey().GetID(),
			Emoji:     reaction.GetText(),
		}
		return message
	}
	if buttons := evt.Message.GetButtonsResponseMessage(); buttons != nil {
		message.Type = domain.MessageEventTypeInteractive
		message.Interactive = &domain.InteractiveEvent{
			Type: "button_reply",
			ButtonReply: &domain.ButtonReplyEvent{
				ID:    buttons.GetSelectedButtonID(),
				Title: buttons.GetSelectedDisplayText(),
			},
		}
		message.Context = mapContext(buttons.GetContextInfo())
		return message
	}
	if list := evt.Message.GetListResponseMessage(); list != nil {
		message.Type = domain.MessageEventTypeInteractive
		message.Interactive = &domain.InteractiveEvent{
			Type: "list_reply",
		}
		if reply := list.GetSingleSelectReply(); reply != nil {
			message.Interactive.ListReply = &domain.ListReplyEvent{
				ID:          reply.GetSelectedRowID(),
				Title:       list.GetTitle(),
				Description: list.GetDescription(),
			}
		}
		message.Context = mapContext(list.GetContextInfo())
		return message
	}
	if contact := evt.Message.GetContactMessage(); contact != nil {
		message.Type = domain.MessageEventTypeContacts
		message.Contacts = parseContactsMessage(contact)
		return message
	}
	if contactsArray := evt.Message.GetContactsArrayMessage(); contactsArray != nil {
		message.Type = domain.MessageEventTypeContacts
		for _, c := range contactsArray.GetContacts() {
			message.Contacts = append(message.Contacts, parseContactMessage(c)...)
		}
		return message
	}

	return message
}

func mapContext(contextInfo *waE2E.ContextInfo) *domain.ContextEvent {
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
	return &domain.ContextEvent{
		ID:   contextInfo.GetStanzaID(),
		From: from,
	}
}

func parseContactsMessage(contact *waE2E.ContactMessage) []domain.ContactEvent {
	return parseContactMessage(contact)
}

func parseContactMessage(contact *waE2E.ContactMessage) []domain.ContactEvent {
	vcardStr := contact.GetVcard()
	if vcardStr == "" {
		return nil
	}
	evt, err := vcard.ParseVCard(vcardStr)
	if err != nil {
		// If parsing fails, return empty — message type stays "contacts"
		// but contacts array will be empty so downstream can still log it.
		return nil
	}
	// If vCard has no name but ContactMessage has DisplayName, use it
	if evt.Name.FormattedName == "" && contact.GetDisplayName() != "" {
		evt.Name.FormattedName = contact.GetDisplayName()
	}
	return []domain.ContactEvent{evt}
}
