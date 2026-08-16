// Package whatsapp hosts the whatsmeow inbound-event handler: it translates
// raw whatsmeow events into the entity event model (via its own dto package)
// and delegates inbound processing to the application service. It is the
// handlers-layer root for the whatsapp channel — no webhook or business logic
// lives here.
package whatsapp

import (
	"context"
	"encoding/json"
	"log"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
	"github.com/afikrim/waba-api-unofficial/internal/handlers/whatsapp/dto"
	"github.com/afikrim/waba-api-unofficial/internal/observability"
	"github.com/google/uuid"
	"go.mau.fi/whatsmeow/types/events"
)

// Handler translates whatsmeow events and delegates inbound processing to the
// application service. It contains no webhook or business logic.
type Handler struct {
	messageService    ports.MessageService
	businessAccountID string
	phoneNumberID     string
	displayPhone      string
	emitter           *observability.Emitter
	logger            *log.Logger
}

// NewHandler builds the whatsmeow inbound-event handler. emitter is the shared
// fire-and-forget activity emitter; it is optional and nil-safe (a nil emitter
// degrades to a no-op — no event row is recorded).
func NewHandler(messageService ports.MessageService, businessAccountID, phoneNumberID, displayPhone string, emitter *observability.Emitter, logger *log.Logger) *Handler {
	if logger == nil {
		logger = log.Default()
	}
	return &Handler{
		messageService:    messageService,
		businessAccountID: businessAccountID,
		phoneNumberID:     phoneNumberID,
		displayPhone:      displayPhone,
		emitter:           emitter,
		logger:            logger,
	}
}

// recordWhatsappEvent builds the whatsapp_event activity row for the translated
// inbound event and hands it to the shared emitter. The serial is generated
// app-side (so the caller can link source_activity_serial without awaiting the
// write — plan §10 R3); the emitter writes fire-and-forget, detached from the
// request context, and swallows recorder errors so observability never affects
// the forward path.
func (h *Handler) recordWhatsappEvent(ctx context.Context, event entity.InboundEvent) uuid.UUID {
	serial := uuid.New()
	payload := buildWhatsappEventPayload(event)
	record := entity.ActivityEvent{
		Serial:            serial,
		Type:              entity.ActivityTypeWhatsAppEvent,
		Status:            entity.ActivityStatusOK,
		PhoneNumberID:     event.PhoneNumberID,
		BusinessAccountID: event.BusinessAccountID,
		Summary:           summarizeWhatsappEvent(event),
		WAMessageID:       event.Message.ID,
		Payload:           payload,
	}
	h.emitter.Emit(ctx, record)
	return serial
}

// buildWhatsappEventPayload returns the jsonb detail for a whatsapp_event row
// (plan §3: compact summary of the WABA-visible fields).
func buildWhatsappEventPayload(event entity.InboundEvent) json.RawMessage {
	summary, _ := json.Marshal(map[string]any{
		"message_id":         event.Message.ID,
		"message_type":       string(event.Message.Type),
		"from":               event.WhatsAppID,
		"from_me":            event.IsFromMe,
		"profile_name":       event.ProfileName,
		"context_message_id": contextMessageID(event.Message),
		"payload_summary":    summarizeWhatsappEvent(event),
	})
	return summary
}

// contextMessageID returns the quoted message id for a reply, if present.
func contextMessageID(message entity.MessageEvent) string {
	if message.Context != nil {
		return message.Context.ID
	}
	return ""
}

// summarizeWhatsappEvent builds a short human line for the activity list.
func summarizeWhatsappEvent(event entity.InboundEvent) string {
	return string(event.Message.Type) + " from " + event.WhatsAppID
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
	if newPhone, ok := dto.PhoneChangeNumber(evt); ok {
		event := dto.ToPhoneChangeEvent(evt, newPhone, h.businessAccountID, h.phoneNumberID, h.displayPhone)
		event.ActivitySerial = h.recordWhatsappEvent(ctx, event)
		if err := h.messageService.Inbound(ctx, &event); err != nil {
			h.logger.Printf("handle phone change: %v", err)
		}
		return
	}

	evt = evt.UnwrapRaw()
	if evt == nil || evt.Message == nil {
		return
	}

	event := dto.ToInboundEvent(evt, h.businessAccountID, h.phoneNumberID, h.displayPhone)
	event.ActivitySerial = h.recordWhatsappEvent(ctx, event)
	if err := h.messageService.Inbound(ctx, &event); err != nil {
		h.logger.Printf("handle inbound message: %v", err)
	}
}
