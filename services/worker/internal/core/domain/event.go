package domain

const (
	MessageEventTypeUnknown     MessageEventType = "unsupported"
	MessageEventTypeText        MessageEventType = "text"
	MessageEventTypeLocation    MessageEventType = "location"
	MessageEventTypeReaction    MessageEventType = "reaction"
	MessageEventTypeInteractive MessageEventType = "interactive"
	MessageEventTypeContacts    MessageEventType = "contacts"
	MessageEventTypeSystem      MessageEventType = "system"
)

const (
	SystemEventTypeUserChangedNumber = "user_changed_number"
)

type MessageEventType string

type MessageEvent struct {
	From        string
	ID          string
	Timestamp   string
	Type        MessageEventType
	Text        string
	Location    *LocationEvent
	Reaction    *ReactionEvent
	Interactive *InteractiveEvent
	Contacts    []ContactEvent
	System      *SystemEvent
	Context     *ContextEvent
}

type SystemEvent struct {
	Type string // "user_changed_number"
	Body string // human-readable
	WaID string // new phone number
}

type LocationEvent struct {
	Latitude  float64
	Longitude float64
	Name      string
	Address   string
}

type ReactionEvent struct {
	MessageID string
	Emoji     string
}

type InteractiveEvent struct {
	Type        string
	ButtonReply *ButtonReplyEvent
	ListReply   *ListReplyEvent
}

type ButtonReplyEvent struct {
	ID    string
	Title string
}

type ListReplyEvent struct {
	ID          string
	Title       string
	Description string
}

type ContextEvent struct {
	ID   string
	From string
}

type ContactEvent struct {
	Addresses []AddressEvent
	Birthday  string
	Emails    []EmailEvent
	Name      NameEvent
	Org       OrganizationEvent
	Phones    []PhoneEvent
	URLs      []URLEvent
}

type NameEvent struct {
	FormattedName string
	FirstName     string
	LastName      string
	MiddleName    string
	Prefix        string
	Suffix        string
}

type PhoneEvent struct {
	Phone string
	Type  string
	WaID  string
}

type EmailEvent struct {
	Email string
	Type  string
}

type AddressEvent struct {
	Street      string
	City        string
	State       string
	Zip         string
	Country     string
	CountryCode string
}

type OrganizationEvent struct {
	Company    string
	Department string
	Title      string
}

type URLEvent struct {
	URL  string
	Type string
}

type InboundEvent struct {
	BusinessAccountID  string
	IsFromMe           bool
	DisplayPhoneNumber string
	PhoneNumberID      string
	ProfileName        string
	WhatsAppID         string
	Message            MessageEvent
}
