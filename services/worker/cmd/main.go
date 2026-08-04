package main

import (
	"context"
	"log"
	"os/signal"
	"syscall"

	"github.com/afikrim/waba-api-unofficial/internal/adapters/apiconfig"
	"github.com/afikrim/waba-api-unofficial/internal/adapters/queue"
	"github.com/afikrim/waba-api-unofficial/internal/adapters/whatsmeow"
	"github.com/afikrim/waba-api-unofficial/internal/config"
	"github.com/afikrim/waba-api-unofficial/internal/service"
	_ "github.com/lib/pq"
	"go.mau.fi/whatsmeow/store/sqlstore"
)

func main() {
	log.Println("waba-api-unofficial — unofficial WABA webhook event replicator")

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	if len(cfg.Devices) == 0 {
		log.Println("warning: no devices configured (WABA_DEVICES empty)")
	}

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

	if cfg.SupabaseDSN == "" {
		log.Fatal("SUPABASE_DSN must be set to the jobs Postgres DSN")
	}
	store, err := queue.NewStore(ctx, cfg.SupabaseDSN, log.Default())
	if err != nil {
		log.Fatalf("initialize queue store: %v", err)
	}
	defer store.Close()

	sessionStore, err := queue.NewSessionStore(store.Pool(), log.Default())
	if err != nil {
		log.Fatalf("initialize session store: %v", err)
	}
	heartbeat := queue.NewHeartbeat(store.Pool(), cfg.HeartbeatInterval, log.Default())

	provider := apiconfig.NewClient(cfg.APIURL, cfg.InternalToken, cfg.WebhookConfigTTL, log.Default())
	svc := service.NewMessage(log.Default(), provider)

	specs := make([]whatsmeow.DeviceSpec, 0, len(cfg.Devices))
	for _, device := range cfg.Devices {
		specs = append(specs, whatsmeow.DeviceSpec{
			PhoneNumberID: device.PhoneNumberID,
			Number:        device.Number,
			DisplayPhone:  device.DisplayPhone,
		})
	}
	registry, err := whatsmeow.NewRegistry(ctx, container, specs, svc, cfg.BusinessAccountID, log.Default())
	if err != nil {
		log.Fatalf("initialize whatsapp registry: %v", err)
	}

	executor := service.NewJobExecutor(registry, sessionStore, registry)
	consumer := queue.NewConsumer(store, executor, cfg.PollInterval, cfg.MaxAttempts, log.Default())

	consumerErr := make(chan error, 1)
	go func() {
		consumerErr <- consumer.Run(ctx)
	}()

	heartbeatErr := make(chan error, 1)
	go func() {
		heartbeatErr <- heartbeat.Run(ctx)
	}()

	// Partial device failures must not kill the worker; the registry keeps the
	// remaining devices connected and retries the failed ones via its
	// Disconnected handler.
	if err := registry.Connect(ctx); err != nil {
		log.Printf("whatsmeow: connect: %v (continuing with connected devices)", err)
	}
	defer registry.DisconnectAll()

	select {
	case err := <-consumerErr:
		if err != nil {
			log.Printf("queue consumer stopped: %v", err)
		}
	case err := <-heartbeatErr:
		if err != nil {
			log.Printf("heartbeat stopped: %v", err)
		}
	case <-ctx.Done():
		log.Println("shutting down")
	}
}
