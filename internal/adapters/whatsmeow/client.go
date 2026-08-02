package whatsmeow

import (
	"context"
	"fmt"

	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store/sqlstore"
	waLog "go.mau.fi/whatsmeow/util/log"
)

type Client struct {
	client *whatsmeow.Client
}

var _ ports.WhatsAppClient = (*Client)(nil)

func NewClient(ctx context.Context, container *sqlstore.Container) (*Client, error) {
	c := &Client{}

	device, err := container.GetFirstDevice(ctx)
	if err != nil {
		return nil, err
	}

	clientLog := waLog.Stdout("Client", "DEBUG", true)
	c.client = whatsmeow.NewClient(device, clientLog)

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
	if c.client != nil {
		c.client.Disconnect()
	}
}

// AddEventHandler registers a raw whatsmeow event handler.
func (c *Client) AddEventHandler(handler func(evt any)) uint32 {
	return c.client.AddEventHandler(handler)
}
