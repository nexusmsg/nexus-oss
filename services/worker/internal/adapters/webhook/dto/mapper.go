package dto

import (
	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
)

// FromEntity maps an entity.WebhookPayload onto the adapter's wire DTO,
// preserving nil-vs-empty slices for the non-omitempty fields (Entry,
// Changes) so the marshaled JSON matches marshaling the entity byte-for-byte.
// It never fails today; the error return keeps the mapper signature
// consistent with the other dto mappers.
func FromEntity(p entity.WebhookPayload) (Payload, error) {
	payload := Payload{Object: p.Object}
	if p.Entry != nil {
		payload.Entry = make([]Entry, 0, len(p.Entry))
		for _, e := range p.Entry {
			payload.Entry = append(payload.Entry, fromEntityEntry(e))
		}
	}
	return payload, nil
}

func fromEntityEntry(e entity.Entry) Entry {
	entry := Entry{ID: e.ID}
	if e.Changes != nil {
		entry.Changes = make([]Change, 0, len(e.Changes))
		for _, ch := range e.Changes {
			entry.Changes = append(entry.Changes, fromEntityChange(ch))
		}
	}
	return entry
}

func fromEntityChange(ch entity.Change) Change {
	return Change{Value: fromEntityValue(ch.Value), Field: ch.Field}
}

func fromEntityValue(v entity.Value) Value {
	value := Value{
		MessagingProduct: v.MessagingProduct,
		Metadata:         fromEntityMetadata(v.Metadata),
	}
	for _, c := range v.Contacts {
		value.Contacts = append(value.Contacts, fromEntityContact(c))
	}
	for _, m := range v.Messages {
		value.Messages = append(value.Messages, fromEntityMessage(m))
	}
	for _, s := range v.Statuses {
		value.Statuses = append(value.Statuses, fromEntityStatus(s))
	}
	return value
}

func fromEntityMetadata(m entity.Metadata) Metadata {
	return Metadata{DisplayPhoneNumber: m.DisplayPhoneNumber, PhoneNumberID: m.PhoneNumberID}
}

func fromEntityContact(c entity.Contact) Contact {
	return Contact{Profile: fromEntityProfile(c.Profile), WaID: c.WaID}
}

func fromEntityProfile(p entity.Profile) Profile {
	return Profile{Name: p.Name}
}

func fromEntityMessage(m entity.Message) Message {
	msg := Message{
		From:      m.From,
		ID:        m.ID,
		Timestamp: m.Timestamp,
		Type:      m.Type,
	}
	if m.Text != nil {
		text := fromEntityText(*m.Text)
		msg.Text = &text
	}
	if m.Location != nil {
		loc := fromEntityLocation(*m.Location)
		msg.Location = &loc
	}
	if m.Reaction != nil {
		reaction := fromEntityReaction(*m.Reaction)
		msg.Reaction = &reaction
	}
	if m.Interactive != nil {
		interactive := fromEntityInteractive(*m.Interactive)
		msg.Interactive = &interactive
	}
	for _, c := range m.Contacts {
		msg.Contacts = append(msg.Contacts, fromEntityContactObject(c))
	}
	if m.System != nil {
		system := fromEntitySystemMessage(*m.System)
		msg.System = &system
	}
	if m.Context != nil {
		context := fromEntityMessageContext(*m.Context)
		msg.Context = &context
	}
	return msg
}

func fromEntityText(t entity.Text) Text {
	return Text{Body: t.Body}
}

func fromEntityLocation(l entity.Location) Location {
	return Location{Latitude: l.Latitude, Longitude: l.Longitude, Name: l.Name, Address: l.Address}
}

func fromEntityReaction(r entity.Reaction) Reaction {
	return Reaction{MessageID: r.MessageID, Emoji: r.Emoji}
}

func fromEntityInteractive(i entity.Interactive) Interactive {
	interactive := Interactive{Type: i.Type}
	if i.ButtonReply != nil {
		br := fromEntityButtonReply(*i.ButtonReply)
		interactive.ButtonReply = &br
	}
	if i.ListReply != nil {
		lr := fromEntityListReply(*i.ListReply)
		interactive.ListReply = &lr
	}
	return interactive
}

func fromEntityButtonReply(b entity.ButtonReply) ButtonReply {
	return ButtonReply{ID: b.ID, Title: b.Title}
}

func fromEntityListReply(l entity.ListReply) ListReply {
	return ListReply{ID: l.ID, Title: l.Title, Description: l.Description}
}

func fromEntitySystemMessage(s entity.SystemMessage) SystemMessage {
	return SystemMessage{Body: s.Body, WaID: s.WaID, Type: s.Type}
}

func fromEntityMessageContext(mc entity.MessageContext) MessageContext {
	return MessageContext{ID: mc.ID, From: mc.From}
}

func fromEntityStatus(s entity.Status) Status {
	return Status{ID: s.ID, Status: s.Status, Timestamp: s.Timestamp, RecipientID: s.RecipientID}
}

func fromEntityContactObject(co entity.ContactObject) ContactObject {
	contact := ContactObject{
		Birthday: co.Birthday,
		Name:     fromEntityNameObject(co.Name),
		Org:      fromEntityOrgObject(co.Org),
	}
	for _, a := range co.Addresses {
		contact.Addresses = append(contact.Addresses, fromEntityAddressObject(a))
	}
	for _, e := range co.Emails {
		contact.Emails = append(contact.Emails, fromEntityEmailObject(e))
	}
	for _, p := range co.Phones {
		contact.Phones = append(contact.Phones, fromEntityPhoneObject(p))
	}
	for _, u := range co.URLs {
		contact.URLs = append(contact.URLs, fromEntityURLObject(u))
	}
	return contact
}

func fromEntityNameObject(n entity.NameObject) NameObject {
	return NameObject{
		FormattedName: n.FormattedName,
		FirstName:     n.FirstName,
		LastName:      n.LastName,
		MiddleName:    n.MiddleName,
		Prefix:        n.Prefix,
		Suffix:        n.Suffix,
	}
}

func fromEntityPhoneObject(p entity.PhoneObject) PhoneObject {
	return PhoneObject{Phone: p.Phone, Type: p.Type, WaID: p.WaID}
}

func fromEntityEmailObject(e entity.EmailObject) EmailObject {
	return EmailObject{Email: e.Email, Type: e.Type}
}

func fromEntityAddressObject(a entity.AddressObject) AddressObject {
	return AddressObject{
		Street:      a.Street,
		City:        a.City,
		State:       a.State,
		Zip:         a.Zip,
		Country:     a.Country,
		CountryCode: a.CountryCode,
	}
}

func fromEntityOrgObject(o entity.OrgObject) OrgObject {
	return OrgObject{Company: o.Company, Department: o.Department, Title: o.Title}
}

func fromEntityURLObject(u entity.URLObject) URLObject {
	return URLObject{URL: u.URL, Type: u.Type}
}
