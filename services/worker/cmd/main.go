package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/adapters/httpapi"
	"github.com/afikrim/waba-api-unofficial/internal/adapters/webhook"
	"github.com/afikrim/waba-api-unofficial/internal/adapters/whatsmeow"
	"github.com/afikrim/waba-api-unofficial/internal/config"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
	"github.com/afikrim/waba-api-unofficial/internal/service"
	_ "github.com/lib/pq"
	"go.mau.fi/whatsmeow/store/sqlstore"
)

func main() {
	log.Println("waba-api-unofficial — unofficial WABA webhook event replicator")

	cfg := config.Load()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	storeDSN := cfg.StoreDSN
	if storeDSN == "" {
		storeDSN = cfg.SupabaseDSN
	}
	if storeDSN == "" {
		log.Fatal("WHATSMEOW_STORE_DSN (or SUPABASE_DSN) must be set to a Postgres DSN")
	}
	container, err := sqlstore.New(ctx, "postgres", storeDSN, nil)
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
	outboundService := service.NewOutbound(waClient)
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

	apiServer := httpapi.NewServer(outboundService, cfg.Webhook.PhoneNumberID, cfg.APIAuthToken)
	serverErr := make(chan error, 1)
	go func() {
		serverErr <- apiServer.Start(fmt.Sprintf(":%d", cfg.Port))
	}()

	select {
	case err := <-serverErr:
		if !errors.Is(err, http.ErrServerClosed) {
			log.Printf("http server stopped: %v", err)
		}
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := apiServer.Shutdown(shutdownCtx); err != nil {
			log.Printf("shutdown http server: %v", err)
		}
	}

	log.Println("shutting down")
}
