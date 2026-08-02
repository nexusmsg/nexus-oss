package domain

import "time"

type ValidationError struct {
	Message string
}

func (e *ValidationError) Error() string {
	return e.Message
}

func NewValidationError(message string) error {
	return &ValidationError{Message: message}
}

type OutboundMessage struct {
	MessagingProduct string `json:"messaging_product"`
	RecipientType    string `json:"recipient_type,omitempty"`
	To               string `json:"to,omitempty"`
	Recipient        string `json:"recipient,omitempty"`
	Type             string `json:"type"`
	Text             *Text  `json:"text,omitempty"`
	Category         string `json:"category,omitempty"`
	TTL              *int   `json:"ttl,omitempty"`
}

type SendResult struct {
	ID        string
	Recipient string
	Timestamp time.Time
}

type OutboundResponse struct {
	MessagingProduct string                   `json:"messaging_product"`
	Contacts         []OutboundContact        `json:"contacts"`
	Messages         []OutboundMessageReceipt `json:"messages"`
}

type OutboundContact struct {
	Input string `json:"input"`
	WaID  string `json:"wa_id"`
}

type OutboundMessageReceipt struct {
	ID string `json:"id"`
}
