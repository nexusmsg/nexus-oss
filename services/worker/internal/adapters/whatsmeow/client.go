package whatsmeow

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/adapters/whatsmeow/dto"
	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
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

// Client is a per-device WhatsApp sender. It serializes outbound sends under
// sendMu and owns the connection lifecycle of a single device.
type Client struct {
	client *whatsmeow.Client
	send   func(context.Context, types.JID, *waE2E.Message) (whatsmeow.SendResponse, error)
	sendMu sync.Mutex
	closed bool
	// number identifies the device in QR output and log lines.
	number string
	logger *log.Logger
}

// newClient builds a per-device sender around raw. The device number labels QR
// output and log lines.
func newClient(raw *whatsmeow.Client, number string, logger *log.Logger) *Client {
	if logger == nil {
		logger = log.Default()
	}
	return &Client{
		client: raw,
		send: func(ctx context.Context, to types.JID, message *waE2E.Message) (whatsmeow.SendResponse, error) {
			return raw.SendMessage(ctx, to, message)
		},
		number: number,
		logger: logger,
	}
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
	c.sendMu.Lock()
	c.closed = true
	c.sendMu.Unlock()
	if c.client != nil {
		c.client.Disconnect()
	}
}

// Send delivers an outbound message synchronously. It serializes the send
// under sendMu, so Disconnect blocks until any in-flight send completes.
func (c *Client) Send(ctx context.Context, message entity.OutboundMessage) (entity.SendResult, error) {
	c.sendMu.Lock()
	defer c.sendMu.Unlock()

	if c.closed {
		return entity.SendResult{}, errors.New("whatsapp sender is closed")
	}
	msg, err := dto.ToWaE2EMessage(message)
	if err != nil {
		return entity.SendResult{}, err
	}
	select {
	case <-ctx.Done():
		return entity.SendResult{}, ctx.Err()
	default:
	}

	jid, err := types.ParseJID(message.To + "@s.whatsapp.net")
	if err != nil {
		return entity.SendResult{}, fmt.Errorf("parse recipient: %w", err)
	}

	response, err := c.send(ctx, jid, msg)
	if err != nil {
		return entity.SendResult{}, err
	}
	return entity.SendResult{
		ID:        string(response.ID),
		Recipient: jid.User,
		Timestamp: response.Timestamp,
	}, nil
}

// AddEventHandler registers a raw whatsmeow event handler.
func (c *Client) AddEventHandler(handler func(evt any)) uint32 {
	return c.client.AddEventHandler(handler)
}
