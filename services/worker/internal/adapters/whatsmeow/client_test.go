package whatsmeow

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
)

func newTestClient(send func(context.Context, types.JID, *waE2E.Message) (whatsmeow.SendResponse, error)) *Client {
	workerCtx, workerStop := context.WithCancel(context.Background())
	c := &Client{
		send:       send,
		sendQueue:  make(chan sendCommand, 32),
		workerCtx:  workerCtx,
		workerStop: workerStop,
		workerDone: make(chan struct{}),
	}
	go c.sendLoop()
	return c
}

func TestClientSendUsesExistingWorker(t *testing.T) {
	var calls atomic.Int32
	client := newTestClient(func(_ context.Context, jid types.JID, message *waE2E.Message) (whatsmeow.SendResponse, error) {
		calls.Add(1)
		if jid.User != "628123456789" || message.GetConversation() != "hello" {
			t.Errorf("send args = %s, %q", jid, message.GetConversation())
		}
		return whatsmeow.SendResponse{ID: "wamid-123"}, nil
	})
	defer client.Disconnect()

	result, err := client.Send(context.Background(), domain.OutboundMessage{
		To:   "628123456789",
		Text: &domain.Text{Body: "hello"},
	})
	if err != nil {
		t.Fatalf("Send() error = %v", err)
	}
	if result.ID != "wamid-123" || calls.Load() != 1 {
		t.Fatalf("result = %+v, calls = %d", result, calls.Load())
	}
}

func TestClientSendCanceledQueuedMessageIsNotSent(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	var calls atomic.Int32
	client := newTestClient(func(ctx context.Context, _ types.JID, _ *waE2E.Message) (whatsmeow.SendResponse, error) {
		calls.Add(1)
		close(started)
		select {
		case <-release:
			return whatsmeow.SendResponse{ID: "wamid-123"}, nil
		case <-ctx.Done():
			return whatsmeow.SendResponse{}, ctx.Err()
		}
	})
	defer client.Disconnect()

	firstDone := make(chan error, 1)
	go func() {
		_, err := client.Send(context.Background(), domain.OutboundMessage{To: "6281", Text: &domain.Text{Body: "first"}})
		firstDone <- err
	}()
	<-started

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := client.Send(ctx, domain.OutboundMessage{To: "6282", Text: &domain.Text{Body: "second"}})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("queued Send() error = %v", err)
	}
	close(release)
	select {
	case err := <-firstDone:
		if err != nil {
			t.Fatalf("first Send() error = %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("first send did not finish")
	}
	if calls.Load() != 1 {
		t.Fatalf("send calls = %d, want 1", calls.Load())
	}
}
