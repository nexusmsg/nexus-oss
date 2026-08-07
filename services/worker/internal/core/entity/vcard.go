package entity

import (
	"fmt"
	"strings"

	"github.com/emersion/go-vcard"
)

// ParseVCard converts a raw vCard string into a ContactEvent.
// Returns an error if the vCard cannot be decoded.
func ParseVCard(raw string) (ContactEvent, error) {
	if raw == "" {
		return ContactEvent{}, fmt.Errorf("vcard: empty input")
	}

	card, err := vcard.NewDecoder(strings.NewReader(raw)).Decode()
	if err != nil {
		return ContactEvent{}, fmt.Errorf("vcard: decode: %w", err)
	}

	var evt ContactEvent

	// Name: FN → FormattedName, N → structured name components
	if fn := card.Value(vcard.FieldFormattedName); fn != "" {
		evt.Name.FormattedName = fn
	}
	if n := card.Value(vcard.FieldName); n != "" {
		parts := strings.SplitN(n, ";", 5)
		for i, p := range parts {
			parts[i] = strings.TrimSpace(p)
		}
		// N format: Family;Given;Additional;Prefix;Suffix
		if len(parts) >= 1 && parts[0] != "" {
			evt.Name.LastName = parts[0]
		}
		if len(parts) >= 2 && parts[1] != "" {
			evt.Name.FirstName = parts[1]
		}
		if len(parts) >= 3 && parts[2] != "" {
			evt.Name.MiddleName = parts[2]
		}
		if len(parts) >= 4 && parts[3] != "" {
			evt.Name.Prefix = parts[3]
		}
		if len(parts) >= 5 && parts[4] != "" {
			evt.Name.Suffix = parts[4]
		}
	}

	// Phones: TEL
	for _, f := range card["TEL"] {
		phone := PhoneEvent{Phone: f.Value}
		if types, ok := f.Params[vcard.ParamType]; ok && len(types) > 0 {
			phone.Type = mapPhoneType(types)
		}
		evt.Phones = append(evt.Phones, phone)
	}

	// Emails: EMAIL
	for _, f := range card["EMAIL"] {
		email := EmailEvent{Email: f.Value}
		if types, ok := f.Params[vcard.ParamType]; ok && len(types) > 0 {
			email.Type = strings.ToUpper(types[0])
		}
		evt.Emails = append(evt.Emails, email)
	}

	// Addresses: ADR
	for _, f := range card["ADR"] {
		// ADR format: POBox;Extended;Street;City;Region;PostalCode;Country
		parts := strings.SplitN(f.Value, ";", 7)
		for i, p := range parts {
			parts[i] = strings.TrimSpace(p)
		}
		addr := AddressEvent{}
		if len(parts) >= 3 && parts[2] != "" {
			addr.Street = parts[2]
		}
		if len(parts) >= 4 && parts[3] != "" {
			addr.City = parts[3]
		}
		if len(parts) >= 5 && parts[4] != "" {
			addr.State = parts[4]
		}
		if len(parts) >= 6 && parts[5] != "" {
			addr.Zip = parts[5]
		}
		if len(parts) >= 7 && parts[6] != "" {
			addr.Country = parts[6]
		}
		evt.Addresses = append(evt.Addresses, addr)
	}

	// Organization: ORG (semicolon-separated: Company;Department;...)
	if org := card.Value(vcard.FieldOrganization); org != "" {
		parts := strings.SplitN(org, ";", 3)
		for i, p := range parts {
			parts[i] = strings.TrimSpace(p)
		}
		if len(parts) >= 1 && parts[0] != "" {
			evt.Org.Company = parts[0]
		}
		if len(parts) >= 2 && parts[1] != "" {
			evt.Org.Department = parts[1]
		}
	}

	// Title: TITLE
	if title := card.Value(vcard.FieldTitle); title != "" {
		evt.Org.Title = title
	}

	// URLs: URL
	for _, f := range card["URL"] {
		urlEvt := URLEvent{URL: f.Value}
		if types, ok := f.Params[vcard.ParamType]; ok && len(types) > 0 {
			urlEvt.Type = strings.ToUpper(types[0])
		}
		evt.URLs = append(evt.URLs, urlEvt)
	}

	// Birthday: BDAY (YYYY-MM-DD)
	if bday := card.Value(vcard.FieldBirthday); bday != "" {
		evt.Birthday = normalizeBirthday(bday)
	}

	return evt, nil
}

// BuildVCard converts a ContactEvent into a vCard 3.0 string.
func BuildVCard(evt ContactEvent) (string, error) {
	var buf strings.Builder
	enc := vcard.NewEncoder(&buf)

	card := make(vcard.Card)
	// The encoder requires a VERSION field; emit a vCard 3.0 card.
	card.SetValue(vcard.FieldVersion, "3.0")

	// Name
	if evt.Name.FormattedName != "" {
		card.SetValue(vcard.FieldFormattedName, evt.Name.FormattedName)
	}
	if evt.Name.LastName != "" || evt.Name.FirstName != "" {
		n := fmt.Sprintf("%s;%s;%s;%s;%s",
			evt.Name.LastName, evt.Name.FirstName,
			evt.Name.MiddleName, evt.Name.Prefix, evt.Name.Suffix)
		card.Add(vcard.FieldName, &vcard.Field{Value: n})
	}

	// Phones
	for _, p := range evt.Phones {
		f := &vcard.Field{Value: p.Phone}
		if p.Type != "" {
			f.Params = vcard.Params{vcard.ParamType: []string{strings.ToLower(p.Type)}}
		}
		card.Add("TEL", f)
	}

	// Emails
	for _, e := range evt.Emails {
		f := &vcard.Field{Value: e.Email}
		if e.Type != "" {
			f.Params = vcard.Params{vcard.ParamType: []string{strings.ToLower(e.Type)}}
		}
		card.Add("EMAIL", f)
	}

	// Addresses
	for _, a := range evt.Addresses {
		adr := fmt.Sprintf(";;%s;%s;%s;%s;%s",
			a.Street, a.City, a.State, a.Zip, a.Country)
		card.Add("ADR", &vcard.Field{Value: adr})
	}

	// Organization
	if evt.Org.Company != "" || evt.Org.Department != "" {
		org := fmt.Sprintf("%s;%s", evt.Org.Company, evt.Org.Department)
		card.Add("ORG", &vcard.Field{Value: org})
	}

	// Title
	if evt.Org.Title != "" {
		card.Add("TITLE", &vcard.Field{Value: evt.Org.Title})
	}

	// URLs
	for _, u := range evt.URLs {
		f := &vcard.Field{Value: u.URL}
		if u.Type != "" {
			f.Params = vcard.Params{vcard.ParamType: []string{strings.ToLower(u.Type)}}
		}
		card.Add("URL", f)
	}

	// Birthday
	if evt.Birthday != "" {
		card.Add("BDAY", &vcard.Field{Value: evt.Birthday})
	}

	if err := enc.Encode(card); err != nil {
		return "", fmt.Errorf("vcard: encode: %w", err)
	}

	return buf.String(), nil
}

// mapPhoneType converts vCard TEL TYPE params to WABA phone types.
// WABA only supports "HOME" and "WORK"; everything else maps to "HOME".
func mapPhoneType(types []string) string {
	for _, t := range types {
		switch strings.ToUpper(t) {
		case "WORK":
			return "WORK"
		case "CELL", "MOBILE", "HOME":
			return "HOME"
		}
	}
	return "HOME"
}

// normalizeBirthday ensures YYYY-MM-DD format.
// vCard BDAY can be "19900101" or "1990-01-01" or with time.
func normalizeBirthday(raw string) string {
	raw = strings.TrimSpace(raw)
	if len(raw) == 8 && raw[4] >= '0' && raw[4] <= '9' {
		// YYYYMMDD → YYYY-MM-DD
		return fmt.Sprintf("%s-%s-%s", raw[0:4], raw[4:6], raw[6:8])
	}
	if len(raw) >= 10 {
		return raw[0:10]
	}
	return raw
}
