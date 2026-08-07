package entity

type WebhookPayload struct {
	Object string  `json:"object"`
	Entry  []Entry `json:"entry"`
}

type Entry struct {
	ID      string   `json:"id"`
	Changes []Change `json:"changes"`
}

type Change struct {
	Value Value  `json:"value"`
	Field string `json:"field"`
}

type Value struct {
	MessagingProduct string    `json:"messaging_product"`
	Metadata         Metadata  `json:"metadata"`
	Contacts         []Contact `json:"contacts,omitempty"`
	Messages         []Message `json:"messages,omitempty"`
	Statuses         []Status  `json:"statuses,omitempty"`
}

type Metadata struct {
	DisplayPhoneNumber string `json:"display_phone_number"`
	PhoneNumberID      string `json:"phone_number_id"`
}

type Contact struct {
	Profile Profile `json:"profile"`
	WaID    string  `json:"wa_id"`
}

type Profile struct {
	Name string `json:"name"`
}

type Message struct {
	From        string          `json:"from"`
	ID          string          `json:"id"`
	Timestamp   string          `json:"timestamp"`
	Type        string          `json:"type"`
	Text        *Text           `json:"text,omitempty"`
	Location    *Location       `json:"location,omitempty"`
	Reaction    *Reaction       `json:"reaction,omitempty"`
	Interactive *Interactive    `json:"interactive,omitempty"`
	Contacts    []ContactObject `json:"contacts,omitempty"`
	System      *SystemMessage  `json:"system,omitempty"`
	Context     *MessageContext `json:"context,omitempty"`
}

type SystemMessage struct {
	Body string `json:"body"`
	WaID string `json:"wa_id"`
	Type string `json:"type"`
}

type Text struct {
	Body string `json:"body"`
}

type Location struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Name      string  `json:"name,omitempty"`
	Address   string  `json:"address,omitempty"`
}

type Reaction struct {
	MessageID string `json:"message_id"`
	Emoji     string `json:"emoji"`
}

type Interactive struct {
	Type        string       `json:"type"`
	ButtonReply *ButtonReply `json:"button_reply,omitempty"`
	ListReply   *ListReply   `json:"list_reply,omitempty"`
}

type ButtonReply struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type ListReply struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
}

type MessageContext struct {
	ID   string `json:"id"`
	From string `json:"from,omitempty"`
}

type Status struct {
	ID          string `json:"id"`
	Status      string `json:"status"`
	Timestamp   string `json:"timestamp"`
	RecipientID string `json:"recipient_id"`
}

// WABA ContactObject types — used in inbound webhook payloads and outbound jobs.

type ContactObject struct {
	Addresses []AddressObject `json:"addresses,omitempty"`
	Birthday  string          `json:"birthday,omitempty"`
	Emails    []EmailObject   `json:"emails,omitempty"`
	Name      NameObject      `json:"name"`
	Org       OrgObject       `json:"org,omitempty"`
	Phones    []PhoneObject   `json:"phones,omitempty"`
	URLs      []URLObject     `json:"urls,omitempty"`
}

type NameObject struct {
	FormattedName string `json:"formatted_name"`
	FirstName     string `json:"first_name,omitempty"`
	LastName      string `json:"last_name,omitempty"`
	MiddleName    string `json:"middle_name,omitempty"`
	Prefix        string `json:"prefix,omitempty"`
	Suffix        string `json:"suffix,omitempty"`
}

type PhoneObject struct {
	Phone string `json:"phone"`
	Type  string `json:"type,omitempty"`
	WaID  string `json:"wa_id,omitempty"`
}

type EmailObject struct {
	Email string `json:"email"`
	Type  string `json:"type,omitempty"`
}

type AddressObject struct {
	Street      string `json:"street,omitempty"`
	City        string `json:"city,omitempty"`
	State       string `json:"state,omitempty"`
	Zip         string `json:"zip,omitempty"`
	Country     string `json:"country,omitempty"`
	CountryCode string `json:"country_code,omitempty"`
}

type OrgObject struct {
	Company    string `json:"company,omitempty"`
	Department string `json:"department,omitempty"`
	Title      string `json:"title,omitempty"`
}

type URLObject struct {
	URL  string `json:"url"`
	Type string `json:"type,omitempty"`
}
