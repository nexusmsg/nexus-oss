package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/afikrim/waba-api-unofficial/internal/adapters/whatsmeow"
	"github.com/afikrim/waba-api-unofficial/internal/config"
	"github.com/afikrim/waba-api-unofficial/internal/service"
	_ "github.com/mattn/go-sqlite3"
	"go.mau.fi/whatsmeow/store/sqlstore"
)

func main() {
	log.Println("waba-api-unofficial — unofficial WABA webhook event replicator")

	cfg := config.Load()

	ctx := context.Background()
	container, err := sqlstore.New(ctx, "sqlite3", "file:whatsmeow.db?_foreign_keys=on", nil)
	if err != nil {
		log.Fatalf("initialize whatsmeow store: %v", err)
	}
	defer container.Close()

	waClient, err := whatsmeow.NewClient(ctx, container)
	if err != nil {
		log.Fatalf("initialize whatsapp client: %v", err)
	}
	svc := service.NewMessage(log.Default())
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

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	log.Println("shutting down")
}
