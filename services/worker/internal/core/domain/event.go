package domain

const (
	MessageEventTypeUnknown     MessageEventType = "unsupported"
	MessageEventTypeText        MessageEventType = "text"
	MessageEventTypeLocation    MessageEventType = "location"
	MessageEventTypeReaction    MessageEventType = "reaction"
	MessageEventTypeInteractive MessageEventType = "interactive"
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
	Context     *ContextEvent
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

type InboundEvent struct {
	BusinessAccountID  string
	IsFromMe           bool
	DisplayPhoneNumber string
	PhoneNumberID      string
	ProfileName        string
	WhatsAppID         string
	Message            MessageEvent
}
