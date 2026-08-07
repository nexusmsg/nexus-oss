package service

import (
	"fmt"
	"strings"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
)

// validateOutboundMessage validates an outbound message payload before it is
// dispatched (Dispatcher) or executed (WhatsAppExecutor).
func validateOutboundMessage(message entity.OutboundMessage) error {
	if message.MessagingProduct != "whatsapp" {
		return entity.NewValidationError("messaging_product must be whatsapp")
	}
	if message.Type != "text" && message.Type != "contacts" {
		return entity.NewValidationError(fmt.Sprintf("message type %q is not supported", message.Type))
	}
	if message.Type == "text" {
		if message.Text == nil || strings.TrimSpace(message.Text.Body) == "" {
			return entity.NewValidationError("text.body is required")
		}
	}
	if message.Type == "contacts" {
		if len(message.Contacts) == 0 {
			return entity.NewValidationError("contacts array must contain at least one contact")
		}
		for i, c := range message.Contacts {
			if strings.TrimSpace(c.Name.FormattedName) == "" {
				return entity.NewValidationError(fmt.Sprintf("contacts[%d].name.formatted_name is required", i))
			}
		}
	}
	if message.To == "" {
		return entity.NewValidationError("to is required")
	}
	if message.Category != "" && message.Category != "utility" && message.Category != "authentication" && message.Category != "service" {
		return entity.NewValidationError("category must be utility, authentication, or service")
	}
	return nil
}
