package service

import (
	"errors"
	"strings"
	"testing"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
)

// validTextMessage is a text payload that passes validateOutboundMessage.
func validTextMessage() entity.OutboundMessage {
	return entity.OutboundMessage{
		MessagingProduct: "whatsapp",
		To:               "628123456789",
		Type:             "text",
		Category:         "utility",
		Text:             &entity.Text{Body: "hello"},
	}
}

func TestValidateOutboundMessageAcceptsValidText(t *testing.T) {
	if err := validateOutboundMessage(validTextMessage()); err != nil {
		t.Fatalf("validateOutboundMessage() error = %v", err)
	}
}

func TestValidateOutboundMessageAcceptsAllCategories(t *testing.T) {
	for _, category := range []string{"", "utility", "authentication", "service"} {
		message := validTextMessage()
		message.Category = category
		if err := validateOutboundMessage(message); err != nil {
			t.Errorf("category %q: validateOutboundMessage() error = %v", category, err)
		}
	}
}

func TestValidateOutboundMessageAcceptsValidContacts(t *testing.T) {
	message := entity.OutboundMessage{
		MessagingProduct: "whatsapp",
		To:               "628123456789",
		Type:             "contacts",
		Contacts: []entity.ContactInput{
			{
				Name:   entity.NameObject{FormattedName: "Aziz Fikri"},
				Phones: []entity.PhoneObject{{Phone: "+628123456789", Type: "MOBILE"}},
			},
		},
	}
	if err := validateOutboundMessage(message); err != nil {
		t.Fatalf("validateOutboundMessage() error = %v", err)
	}
}

func TestValidateOutboundMessageRejectsInvalid(t *testing.T) {
	cases := []struct {
		name    string
		message entity.OutboundMessage
		wantErr string // substring expected in the error
	}{
		{
			name:    "wrong messaging product",
			message: entity.OutboundMessage{MessagingProduct: "other", Type: "text", To: "6281", Text: &entity.Text{Body: "hello"}},
			wantErr: "messaging_product must be whatsapp",
		},
		{
			name:    "unsupported type",
			message: entity.OutboundMessage{MessagingProduct: "whatsapp", Type: "image", To: "6281", Text: &entity.Text{Body: "hello"}},
			wantErr: `message type "image" is not supported`,
		},
		{
			name:    "text message without body",
			message: entity.OutboundMessage{MessagingProduct: "whatsapp", Type: "text", To: "6281"},
			wantErr: "text.body is required",
		},
		{
			name:    "text message with blank body",
			message: entity.OutboundMessage{MessagingProduct: "whatsapp", Type: "text", To: "6281", Text: &entity.Text{Body: "   "}},
			wantErr: "text.body is required",
		},
		{
			name:    "missing recipient",
			message: entity.OutboundMessage{MessagingProduct: "whatsapp", Type: "text", Text: &entity.Text{Body: "hello"}},
			wantErr: "to is required",
		},
		{
			name:    "invalid category",
			message: entity.OutboundMessage{MessagingProduct: "whatsapp", Type: "text", To: "6281", Category: "marketing", Text: &entity.Text{Body: "hello"}},
			wantErr: "category must be utility, authentication, or service",
		},
		{
			name: "contacts without entries",
			message: entity.OutboundMessage{
				MessagingProduct: "whatsapp",
				Type:             "contacts",
				To:               "6281",
				Contacts:         []entity.ContactInput{},
			},
			wantErr: "contacts array must contain at least one contact",
		},
		{
			name: "contact without formatted name",
			message: entity.OutboundMessage{
				MessagingProduct: "whatsapp",
				Type:             "contacts",
				To:               "6281",
				Contacts:         []entity.ContactInput{{}},
			},
			wantErr: "contacts[0].name.formatted_name is required",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateOutboundMessage(tc.message)
			if err == nil {
				t.Fatal("validateOutboundMessage() returned nil error")
			}
			var validationErr *entity.ValidationError
			if !errors.As(err, &validationErr) {
				t.Errorf("error = %v, want *entity.ValidationError", err)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("validateOutboundMessage() error = %q, want substring %q", err, tc.wantErr)
			}
		})
	}
}
