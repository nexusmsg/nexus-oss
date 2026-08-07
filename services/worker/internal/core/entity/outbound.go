package entity

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
	MessagingProduct string         `json:"messaging_product"`
	RecipientType    string         `json:"recipient_type,omitempty"`
	To               string         `json:"to,omitempty"`
	Recipient        string         `json:"recipient,omitempty"`
	Type             string         `json:"type"`
	Text             *Text          `json:"text,omitempty"`
	Contacts         []ContactInput `json:"contacts,omitempty"`
	Category         string         `json:"category,omitempty"`
	TTL              *int           `json:"ttl,omitempty"`
}

type ContactInput struct {
	Addresses []AddressObject `json:"addresses,omitempty"`
	Birthday  string          `json:"birthday,omitempty"`
	Emails    []EmailObject   `json:"emails,omitempty"`
	Name      NameObject      `json:"name"`
	Org       OrgObject       `json:"org,omitempty"`
	Phones    []PhoneObject   `json:"phones,omitempty"`
	URLs      []URLObject     `json:"urls,omitempty"`
}

type SendResult struct {
	ID        string
	Recipient string
	Timestamp time.Time
}
