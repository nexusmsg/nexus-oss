package whatsmeow

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/adapters/vcard"
	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
)

// reconnectInterval is the delay between reconnect attempts after an
// unexpected disconnect.
const reconnectInterval = 5 * time.Second

// ErrNotPaired reports that a device has no stored session, so it cannot
// connect until a pairing job pairs it through Pair.
var ErrNotPaired = errors.New("whatsmeow: device is not paired")

// Client is a per-device WhatsApp sender. It serializes outbound sends through
// a bounded worker queue and owns the connection lifecycle of a single device.
type Client struct {
	client     *whatsmeow.Client
	send       func(context.Context, types.JID, *waE2E.Message) (whatsmeow.SendResponse, error)
	sendQueue  chan sendCommand
	workerCtx  context.Context
	workerStop context.CancelFunc
	workerDone chan struct{}
	stateMu    sync.RWMutex
	closed     bool
	// number identifies the device in QR output and log lines.
	number string
	logger *log.Logger
}

type sendCommand struct {
	ctx      context.Context
	message  domain.OutboundMessage
	response chan sendResponse
}

type sendResponse struct {
	result domain.SendResult
	err    error
}

// newClient builds a per-device sender around raw and starts its send worker.
// The device number labels QR output and log lines.
func newClient(raw *whatsmeow.Client, number string, logger *log.Logger) *Client {
	if logger == nil {
		logger = log.Default()
	}
	workerCtx, workerStop := context.WithCancel(context.Background())
	c := &Client{
		client: raw,
		send: func(ctx context.Context, to types.JID, message *waE2E.Message) (whatsmeow.SendResponse, error) {
			return raw.SendMessage(ctx, to, message)
		},
		sendQueue:  make(chan sendCommand, 32),
		workerCtx:  workerCtx,
		workerStop: workerStop,
		workerDone: make(chan struct{}),
		number:     number,
		logger:     logger,
	}
	go c.sendLoop()
	return c
}

// Connect connects this device, running QR pairing when no session is stored.
func (c *Client) Connect(ctx context.Context) error {
	return c.connect(ctx)
}

// hasSession reports whether the device has a stored WhatsApp session, i.e.
// it has been paired at least once and can connect without a QR flow.
func (c *Client) hasSession() bool {
	return c.client != nil && c.client.Store != nil && c.client.Store.ID != nil
}

// connect establishes the websocket connection for a device that already has a
// stored session. Devices without a stored session return ErrNotPaired: QR
// pairing is driven exclusively by pairing jobs through Pair, so a plain
// connect (startup or reconnect) never auto-triggers QR output.
func (c *Client) connect(ctx context.Context) error {
	if !c.hasSession() {
		return ErrNotPaired
	}
	return c.client.ConnectContext(ctx)
}

// Pair runs a QR pairing flow for the device and returns the first QR code.
// It returns an error if the device already has a stored session or if the
// context expires before a code is emitted.
func (c *Client) Pair(ctx context.Context) (string, error) {
	if c.client == nil || c.client.Store == nil {
		return "", errors.New("whatsmeow: client or store is nil")
	}
	if c.client.Store.ID != nil {
		return "", ports.ErrAlreadyPaired
	}
	qrChan, err := c.client.GetQRChannel(ctx)
	if err != nil {
		return "", fmt.Errorf("whatsmeow: get QR channel: %w", err)
	}
	if err := c.client.ConnectContext(ctx); err != nil {
		return "", fmt.Errorf("whatsmeow: connect for pairing: %w", err)
	}
	for {
		select {
		case <-ctx.Done():
			return "", fmt.Errorf("whatsmeow: pair: %w", ctx.Err())
		case evt, ok := <-qrChan:
			if !ok {
				return "", errors.New("whatsmeow: QR channel closed before a code was received")
			}
			if evt.Event == "code" {
				return evt.Code, nil
			}
			if evt.Event == "error" {
				if evt.Error != nil {
					return "", fmt.Errorf("whatsmeow: pair: %w", evt.Error)
				}
				return "", errors.New("whatsmeow: pair error")
			}
		}
	}
}

// Logout disconnects the device and deletes its stored session so the next
// pairing starts from a clean state.
func (c *Client) Logout(ctx context.Context) error {
	if c.client == nil {
		return errors.New("whatsmeow: client is nil")
	}
	if err := c.client.Logout(ctx); err != nil {
		return fmt.Errorf("whatsmeow: logout: %w", err)
	}
	return nil
}

func (c *Client) Disconnect() {
	c.stateMu.Lock()
	if !c.closed {
		c.closed = true
		c.workerStop()
	}
	c.stateMu.Unlock()
	<-c.workerDone
	if c.client != nil {
		c.client.Disconnect()
	}
}

func (c *Client) Send(ctx context.Context, message domain.OutboundMessage) (domain.SendResult, error) {
	command := sendCommand{ctx: ctx, message: message, response: make(chan sendResponse, 1)}

	c.stateMu.RLock()
	if c.closed {
		c.stateMu.RUnlock()
		return domain.SendResult{}, errors.New("whatsapp sender is closed")
	}
	c.stateMu.RUnlock()
	select {
	case c.sendQueue <- command:
	case <-ctx.Done():
		return domain.SendResult{}, ctx.Err()
	case <-c.workerCtx.Done():
		return domain.SendResult{}, errors.New("whatsapp sender is closed")
	}

	select {
	case response := <-command.response:
		return response.result, response.err
	case <-ctx.Done():
		return domain.SendResult{}, ctx.Err()
	case <-c.workerCtx.Done():
		return domain.SendResult{}, errors.New("whatsapp sender is closed")
	}
}

func (c *Client) sendLoop() {
	defer close(c.workerDone)
	for {
		select {
		case command := <-c.sendQueue:
			c.handleSend(command)
		case <-c.workerCtx.Done():
			c.failQueuedSends()
			return
		}
	}
}

func (c *Client) handleSend(command sendCommand) {
	if command.message.Text == nil && command.message.Type != "contacts" {
		command.response <- sendResponse{err: errors.New("text message is missing")}
		return
	}
	select {
	case <-command.ctx.Done():
		command.response <- sendResponse{err: command.ctx.Err()}
		return
	default:
	}

	jid, err := types.ParseJID(command.message.To + "@s.whatsapp.net")
	if err != nil {
		command.response <- sendResponse{err: fmt.Errorf("parse recipient: %w", err)}
		return
	}

	var msg *waE2E.Message
	if command.message.Type == "contacts" {
		msg = buildContactMessage(command.message.Contacts)
		if msg == nil {
			command.response <- sendResponse{err: errors.New("contacts message is missing contacts")}
			return
		}
	} else {
		text := command.message.Text.Body
		msg = &waE2E.Message{Conversation: &text}
	}

	sendCtx, cancel := context.WithCancel(command.ctx)
	stop := context.AfterFunc(c.workerCtx, cancel)
	response, err := c.send(sendCtx, jid, msg)
	stop()
	cancel()
	if err != nil {
		command.response <- sendResponse{err: err}
		return
	}
	command.response <- sendResponse{result: domain.SendResult{
		ID:        string(response.ID),
		Recipient: jid.User,
		Timestamp: response.Timestamp,
	}}
}

// buildContactMessage creates a WhatsApp contact message from domain contacts.
// Returns ContactMessage for single contact, ContactsArrayMessage for multiple.
func buildContactMessage(contacts []domain.ContactInput) *waE2E.Message {
	if len(contacts) == 0 {
		return nil
	}

	if len(contacts) == 1 {
		vcardStr, err := buildSingleVCard(contacts[0])
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
		vcardStr, err := buildSingleVCard(c)
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

// buildSingleVCard converts one ContactInput into a vCard string.
func buildSingleVCard(c domain.ContactInput) (string, error) {
	evt := domain.ContactEvent{
		Birthday: c.Birthday,
		Name: domain.NameEvent{
			FormattedName: c.Name.FormattedName,
			FirstName:     c.Name.FirstName,
			LastName:      c.Name.LastName,
			MiddleName:    c.Name.MiddleName,
			Prefix:        c.Name.Prefix,
			Suffix:        c.Name.Suffix,
		},
		Org: domain.OrganizationEvent{
			Company:    c.Org.Company,
			Department: c.Org.Department,
			Title:      c.Org.Title,
		},
	}
	for _, p := range c.Phones {
		evt.Phones = append(evt.Phones, domain.PhoneEvent{Phone: p.Phone, Type: p.Type, WaID: p.WaID})
	}
	for _, e := range c.Emails {
		evt.Emails = append(evt.Emails, domain.EmailEvent{Email: e.Email, Type: e.Type})
	}
	for _, a := range c.Addresses {
		evt.Addresses = append(evt.Addresses, domain.AddressEvent{
			Street: a.Street, City: a.City, State: a.State,
			Zip: a.Zip, Country: a.Country, CountryCode: a.CountryCode,
		})
	}
	for _, u := range c.URLs {
		evt.URLs = append(evt.URLs, domain.URLEvent{URL: u.URL, Type: u.Type})
	}
	return vcard.BuildVCard(evt)
}

func (c *Client) failQueuedSends() {
	for {
		select {
		case command := <-c.sendQueue:
			command.response <- sendResponse{err: errors.New("whatsapp sender is closed")}
		default:
			return
		}
	}
}

// AddEventHandler registers a raw whatsmeow event handler.
func (c *Client) AddEventHandler(handler func(evt any)) uint32 {
	return c.client.AddEventHandler(handler)
}
