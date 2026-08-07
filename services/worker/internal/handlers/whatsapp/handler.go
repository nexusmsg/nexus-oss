// Package whatsapp hosts the whatsmeow inbound-event handler: it translates
// raw whatsmeow events into the entity event model (via its own dto package)
// and delegates inbound processing to the application service. It is the
// handlers-layer root for the whatsapp channel — no webhook or business logic
// lives here.
package whatsapp

import (
	"context"
	"log"

	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
	"github.com/afikrim/waba-api-unofficial/internal/handlers/whatsapp/dto"
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
	if newPhone, ok := dto.PhoneChangeNumber(evt); ok {
		event := dto.ToPhoneChangeEvent(evt, newPhone, h.businessAccountID, h.phoneNumberID, h.displayPhone)
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
	if err := h.messageService.Inbound(ctx, &event); err != nil {
		h.logger.Printf("handle inbound message: %v", err)
	}
}
