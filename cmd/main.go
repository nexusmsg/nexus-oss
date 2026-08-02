package main

import (
	"context"
	"log"
	"os/signal"
	"syscall"

	"github.com/afikrim/waba-api-unofficial/internal/adapters/webhook"
	"github.com/afikrim/waba-api-unofficial/internal/adapters/whatsmeow"
	"github.com/afikrim/waba-api-unofficial/internal/config"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
	"github.com/afikrim/waba-api-unofficial/internal/service"
	_ "github.com/mattn/go-sqlite3"
	"go.mau.fi/whatsmeow/store/sqlstore"
)

func main() {
	log.Println("waba-api-unofficial — unofficial WABA webhook event replicator")

	cfg := config.Load()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	container, err := sqlstore.New(ctx, "sqlite3", "file:whatsmeow.db?_foreign_keys=on", nil)
	if err != nil {
		log.Fatalf("initialize whatsmeow store: %v", err)
	}
	defer container.Close()

	waClient, err := whatsmeow.NewClient(ctx, container)
	if err != nil {
		log.Fatalf("initialize whatsapp client: %v", err)
	}
	var forwarder ports.WebhookForwarder
	if cfg.Webhook.URL != "" {
		forwarder = webhook.NewClient(cfg.Webhook.URL, cfg.Webhook.Secret)
	} else {
		log.Println("WEBHOOK_URL is empty; webhook forwarding is disabled")
	}
	svc := service.NewMessage(log.Default(), forwarder)
	eventHandler := whatsmeow.NewHandler(
		svc,
		cfg.Webhook.BusinessAccountID,
		cfg.Webhook.PhoneNumberID,
		cfg.Webhook.DisplayPhoneNumber,
		log.Default(),
	)

	waClient.AddEventHandler(eventHandler.Handle(ctx))

	if err := waClient.Connect(ctx); err != nil {
		log.Fatalf("connect whatsapp: %v", err)
	}
	defer waClient.Disconnect()

	<-ctx.Done()

	log.Println("shutting down")
}
