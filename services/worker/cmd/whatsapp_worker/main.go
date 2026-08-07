package main

import (
	"context"
	"log"
	"os/signal"
	"syscall"

	"github.com/afikrim/waba-api-unofficial/internal/adapters/apiconfig"
	"github.com/afikrim/waba-api-unofficial/internal/adapters/queue"
	"github.com/afikrim/waba-api-unofficial/internal/adapters/webhook"
	"github.com/afikrim/waba-api-unofficial/internal/adapters/whatsmeow"
	"github.com/afikrim/waba-api-unofficial/internal/config"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
	"github.com/afikrim/waba-api-unofficial/internal/handlers/channel"
	"github.com/afikrim/waba-api-unofficial/internal/handlers/whatsapp"
	"github.com/afikrim/waba-api-unofficial/internal/service"
	_ "github.com/lib/pq"
	"go.mau.fi/whatsmeow/store/sqlstore"
)

// cmd/whatsapp_worker is the stateful executor half of the worker split: it
// owns the DeviceManager and WhatsMeow clients, polls whatsmeow_jobs, executes
// each job, and writes the terminal status + result back to the originating
// jobs row via source_job_serial. Single-instance for now.
func main() {
	log.Println("waba-api-unofficial — stateful whatsapp worker (whatsmeow_jobs executor)")

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
	// One pool backs the whatsmeow_jobs queue store and the jobs write-back
	// store. NewStore owns the pool; the jobs store shares it.
	queueStore, err := queue.NewStore(ctx, cfg.SupabaseDSN, "whatsmeow_jobs", log.Default())
	if err != nil {
		log.Fatalf("initialize queue store: %v", err)
	}
	jobsStore := queue.NewStoreWithPool(queueStore.Pool(), "jobs", log.Default())

	sessionStore, err := queue.NewSessionStore(queueStore.Pool(), log.Default())
	if err != nil {
		log.Fatalf("initialize session store: %v", err)
	}

	provider := apiconfig.NewClient(cfg.APIURL, cfg.InternalToken, cfg.WebhookConfigTTL, log.Default())
	svc := service.NewMessage(log.Default(), provider, webhook.NewClient())

	// The event-handler factory is composed here, in the root, so the
	// whatsmeow adapter never constructs handlers-layer types itself.
	handlerFactory := func(messageService ports.MessageService, businessAccountID, phoneNumberID, displayPhone string, logger *log.Logger) func(ctx context.Context) func(evt any) {
		return whatsapp.NewHandler(messageService, businessAccountID, phoneNumberID, displayPhone, logger).Handle
	}

	manager := whatsmeow.NewDeviceManager(container, svc, cfg.BusinessAccountID, handlerFactory, log.Default())
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

	executor := service.NewWhatsAppExecutor(manager, sessionStore, manager, jobsStore, log.Default())
	consumer := channel.NewConsumer(queueStore, executor, cfg.PollInterval, cfg.MaxAttempts, log.Default())

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
	queueStore.Close()
}
