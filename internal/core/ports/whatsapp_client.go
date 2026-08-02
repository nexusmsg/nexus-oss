package ports

import "context"

type WhatsAppClient interface {
	Connect(ctx context.Context) error
	Disconnect()
}
