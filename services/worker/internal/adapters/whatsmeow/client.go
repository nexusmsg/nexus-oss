package whatsmeow

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
)

// reconnectInterval is the delay between reconnect attempts after an
// unexpected disconnect.
const reconnectInterval = 5 * time.Second

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
	// reconnectGate serializes reconnect loops so concurrent Disconnected
	// events cannot spawn overlapping connect attempts.
	reconnectGate chan struct{}
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
		sendQueue:     make(chan sendCommand, 32),
		workerCtx:     workerCtx,
		workerStop:    workerStop,
		workerDone:    make(chan struct{}),
		reconnectGate: make(chan struct{}, 1),
		number:        number,
		logger:        logger,
	}
	go c.sendLoop()
	return c
}

// Connect connects this device, running QR pairing when no session is stored.
func (c *Client) Connect(ctx context.Context) error {
	return c.connect(ctx)
}

// connect establishes the websocket connection for the device. Devices without
// a stored session print QR codes for manual pairing.
func (c *Client) connect(ctx context.Context) error {
	if c.client.Store.ID == nil {
		// No ID stored, new login
		qrChan, err := c.client.GetQRChannel(ctx)
		if err != nil {
			return err
		}
		err = c.client.ConnectContext(ctx)
		if err != nil {
			return err
		}
		for evt := range qrChan {
			if evt.Event == "code" {
				// Render the QR code here
				// e.g. qrterminal.GenerateHalfBlock(evt.Code, qrterminal.L, os.Stdout)
				// or just manually `echo 2@... | qrencode -t ansiutf8` in a terminal
				fmt.Printf("QR code [%s]: %s\n", c.number, evt.Code)
			} else {
				fmt.Printf("Login event [%s]: %s\n", c.number, evt.Event)
			}
		}
	} else {
		// Already logged in, just connect
		err := c.client.ConnectContext(ctx)
		if err != nil {
			return err
		}
	}
	return nil
}

// reconnectLoop reconnects the device after an unexpected disconnect, retrying
// every reconnectInterval while ctx is alive. It returns on the first
// successful connect or when ctx or the send worker is stopped, so shutdown
// never leaks reconnect goroutines.
func (c *Client) reconnectLoop(ctx context.Context) {
	select {
	case c.reconnectGate <- struct{}{}:
		defer func() { <-c.reconnectGate }()
	case <-ctx.Done():
		return
	case <-c.workerCtx.Done():
		return
	}
	ticker := time.NewTicker(reconnectInterval)
	defer ticker.Stop()
	for {
		err := c.connect(ctx)
		switch {
		case err == nil:
			return
		case errors.Is(err, whatsmeow.ErrAlreadyConnected):
			// whatsmeow reconnected before us, nothing left to do.
			return
		default:
			c.logger.Printf("whatsmeow: reconnect device %s: %v", c.number, err)
		}
		select {
		case <-ctx.Done():
			return
		case <-c.workerCtx.Done():
			return
		case <-ticker.C:
		}
	}
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
	if command.message.Text == nil {
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
	text := command.message.Text.Body
	sendCtx, cancel := context.WithCancel(command.ctx)
	stop := context.AfterFunc(c.workerCtx, cancel)
	response, err := c.send(sendCtx, jid, &waE2E.Message{Conversation: &text})
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
