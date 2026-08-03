package whatsmeow

import (
	"bytes"
	"context"
	"log"
	"strings"
	"testing"

	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

func TestHandlerLogsReceivedIncomingMessage(t *testing.T) {
	var output bytes.Buffer
	handler := NewHandler(nil, "", "", "", log.New(&output, "", 0))

	handler.Handle(context.Background())(&events.Message{
		Info: types.MessageInfo{
			ID:   "message-123",
			Type: "conversation",
			MessageSource: types.MessageSource{
				Sender: types.JID{User: "628123456789"},
			},
		},
	})

	logLine := output.String()
	for _, part := range []string{
		"received incoming WhatsMeow message",
		"id=message-123",
		"from=628123456789",
		"type=conversation",
		"from_me=false",
	} {
		if !strings.Contains(logLine, part) {
			t.Errorf("log %q does not contain %q", logLine, part)
		}
	}
}
