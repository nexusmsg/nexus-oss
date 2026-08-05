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

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)

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

	if cfg.SupabaseDSN == "" {
		log.Fatal("SUPABASE_DSN must be set to the jobs Postgres DSN")
	}
	store, err := queue.NewStore(ctx, cfg.SupabaseDSN, log.Default())
	if err != nil {
		log.Fatalf("initialize queue store: %v", err)
	}

	sessionStore, err := queue.NewSessionStore(store.Pool(), log.Default())
	if err != nil {
		log.Fatalf("initialize session store: %v", err)
	}

	provider := apiconfig.NewClient(cfg.APIURL, cfg.InternalToken, cfg.WebhookConfigTTL, log.Default())
	svc := service.NewMessage(log.Default(), provider)

	manager := whatsmeow.NewDeviceManager(container, svc, cfg.BusinessAccountID, log.Default())
	heartbeat := queue.NewHeartbeat(sessionStore, manager, cfg.HeartbeatInterval, log.Default())

	// Boot sync: provision a device per stored session. Partial failures must
	// not kill boot, so per-device errors are logged and skipped.
	sessions, err := sessionStore.ListSessions(ctx)
	if err != nil {
		log.Printf("whatsmeow: list sessions at boot: %v", err)
	} else {
		for _, s := range sessions {
			if err := manager.EnsureDevice(ctx, s); err != nil {
				log.Printf("whatsmeow: ensure device %s: %v", s.PhoneNumberID, err)
			}
		}
	}
	if err := manager.ConnectStored(ctx); err != nil {
		log.Printf("whatsmeow: connect stored devices: %v", err)
	}

	executor := service.NewJobExecutor(manager, sessionStore, manager)
	consumer := queue.NewConsumer(store, executor, cfg.PollInterval, cfg.MaxAttempts, log.Default())

	consumerErr := make(chan error, 1)
	go func() {
		consumerErr <- consumer.Run(ctx)
	}()

	heartbeatErr := make(chan error, 1)
	go func() {
		heartbeatErr <- heartbeat.Run(ctx)
	}()

	// Wait for the first goroutine to stop or an OS signal, then shut down in
	// order: signal ctx cancel, stop consumer & heartbeat, shutdown devices,
	// close the stores.
	consumerFinished := false
	heartbeatFinished := false

	select {
	case err := <-consumerErr:
		consumerFinished = true
		if err != nil {
			log.Printf("queue consumer stopped: %v", err)
		}
	case err := <-heartbeatErr:
		heartbeatFinished = true
		if err != nil {
			log.Printf("heartbeat stopped: %v", err)
		}
	case <-ctx.Done():
		log.Println("shutting down")
	}

	stop()

	if !consumerFinished {
		if err := <-consumerErr; err != nil {
			log.Printf("queue consumer stopped: %v", err)
		}
	}
	if !heartbeatFinished {
		if err := <-heartbeatErr; err != nil {
			log.Printf("heartbeat stopped: %v", err)
		}
	}

	if err := manager.Shutdown(context.Background()); err != nil {
		log.Printf("whatsmeow: manager shutdown: %v", err)
	}

	container.Close()
	store.Close()
}
