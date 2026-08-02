package whatsmeow

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	waLog "go.mau.fi/whatsmeow/util/log"
)

type Client struct {
	client     *whatsmeow.Client
	send       func(context.Context, types.JID, *waE2E.Message) (whatsmeow.SendResponse, error)
	sendQueue  chan sendCommand
	workerCtx  context.Context
	workerStop context.CancelFunc
	workerDone chan struct{}
	stateMu    sync.RWMutex
	closed     bool
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

var _ ports.WhatsAppClient = (*Client)(nil)

func NewClient(ctx context.Context, container *sqlstore.Container) (*Client, error) {
	workerCtx, workerStop := context.WithCancel(context.Background())
	c := &Client{
		sendQueue:  make(chan sendCommand, 32),
		workerCtx:  workerCtx,
		workerStop: workerStop,
		workerDone: make(chan struct{}),
	}

	device, err := container.GetFirstDevice(ctx)
	if err != nil {
		workerStop()
		return nil, err
	}

	c.client = whatsmeow.NewClient(device, waLog.Noop)
	c.send = func(ctx context.Context, to types.JID, message *waE2E.Message) (whatsmeow.SendResponse, error) {
		return c.client.SendMessage(ctx, to, message)
	}
	go c.sendLoop()

	return c, nil
}

func (c *Client) Connect(ctx context.Context) error {
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
				fmt.Println("QR code:", evt.Code)
			} else {
				fmt.Println("Login event:", evt.Event)
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
