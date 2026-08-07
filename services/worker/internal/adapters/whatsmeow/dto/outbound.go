// Outbound mappers translate entity outbound messages into whatsmeow driver
// message types. They are pure translation: no I/O, no logging, no business
// rules. The adapter calls these mappers and delegates the resulting message
// to the driver.
package dto

import (
	"errors"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
	"go.mau.fi/whatsmeow/proto/waE2E"
)

// ToWaE2EMessage maps an outbound entity message into the driver message
// type, branching on the text vs contacts message kind. A non-contacts message
// without a text body, or a contacts message with no buildable contacts,
// returns an error.
func ToWaE2EMessage(message entity.OutboundMessage) (*waE2E.Message, error) {
	if message.Text == nil && message.Type != "contacts" {
		return nil, errors.New("text message is missing")
	}
	if message.Type == "contacts" {
		msg := BuildContactMessage(message.Contacts)
		if msg == nil {
			return nil, errors.New("contacts message is missing contacts")
		}
		return msg, nil
	}
	text := message.Text.Body
	return &waE2E.Message{Conversation: &text}, nil
}

// BuildContactMessage creates a WhatsApp contact message from domain contacts.
// Returns ContactMessage for single contact, ContactsArrayMessage for multiple.
func BuildContactMessage(contacts []entity.ContactInput) *waE2E.Message {
	if len(contacts) == 0 {
		return nil
	}

	if len(contacts) == 1 {
		vcardStr, err := BuildSingleVCard(contacts[0])
		if err != nil {
			return nil
		}
		displayName := contacts[0].Name.FormattedName
		return &waE2E.Message{
			ContactMessage: &waE2E.ContactMessage{
				DisplayName: &displayName,
				Vcard:       &vcardStr,
			},
		}
	}

	// Multiple contacts → ContactsArrayMessage
	var waContacts []*waE2E.ContactMessage
	var arrayName string
	for i, c := range contacts {
		vcardStr, err := BuildSingleVCard(c)
		if err != nil {
			continue
		}
		name := c.Name.FormattedName
		waContacts = append(waContacts, &waE2E.ContactMessage{
			DisplayName: &name,
			Vcard:       &vcardStr,
		})
		if i == 0 && name != "" {
			arrayName = name
		}
	}
	if len(waContacts) == 0 {
		return nil
	}
	return &waE2E.Message{
		ContactsArrayMessage: &waE2E.ContactsArrayMessage{
			DisplayName: &arrayName,
			Contacts:    waContacts,
		},
	}
}

// BuildSingleVCard converts one ContactInput into a vCard string.
func BuildSingleVCard(c entity.ContactInput) (string, error) {
	evt := entity.ContactEvent{
		Birthday: c.Birthday,
		Name: entity.NameEvent{
			FormattedName: c.Name.FormattedName,
			FirstName:     c.Name.FirstName,
			LastName:      c.Name.LastName,
			MiddleName:    c.Name.MiddleName,
			Prefix:        c.Name.Prefix,
			Suffix:        c.Name.Suffix,
		},
		Org: entity.OrganizationEvent{
			Company:    c.Org.Company,
			Department: c.Org.Department,
			Title:      c.Org.Title,
		},
	}
	for _, p := range c.Phones {
		evt.Phones = append(evt.Phones, entity.PhoneEvent{Phone: p.Phone, Type: p.Type, WaID: p.WaID})
	}
	for _, e := range c.Emails {
		evt.Emails = append(evt.Emails, entity.EmailEvent{Email: e.Email, Type: e.Type})
	}
	for _, a := range c.Addresses {
		evt.Addresses = append(evt.Addresses, entity.AddressEvent{
			Street: a.Street, City: a.City, State: a.State,
			Zip: a.Zip, Country: a.Country, CountryCode: a.CountryCode,
		})
	}
	for _, u := range c.URLs {
		evt.URLs = append(evt.URLs, entity.URLEvent{URL: u.URL, Type: u.Type})
	}
	return entity.BuildVCard(evt)
}
