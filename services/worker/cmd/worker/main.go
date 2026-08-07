package main

import (
	"context"
	"log"
	"os/signal"
	"syscall"

	"github.com/afikrim/waba-api-unofficial/internal/adapters/queue"
	"github.com/afikrim/waba-api-unofficial/internal/config"
	"github.com/afikrim/waba-api-unofficial/internal/handlers/channel"
	"github.com/afikrim/waba-api-unofficial/internal/service"
)

// cmd/worker is the stateless dispatcher half of the worker split: it polls
// the jobs table, validates each job, and forwards it to whatsmeow_jobs for
// the stateful whatsapp worker to execute. It holds no WhatsMeow state and can
// run N replicas.
func main() {
	log.Println("waba-api-unofficial — stateless dispatcher (jobs -> whatsmeow_jobs)")

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	if cfg.SupabaseDSN == "" {
		log.Fatal("SUPABASE_DSN must be set to the jobs Postgres DSN")
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)

	// One pool backs both Stores: the jobs consumer and the whatsmeow_jobs
	// dispatcher. NewStore owns the pool; the dispatcher store shares it.
	store, err := queue.NewStore(ctx, cfg.SupabaseDSN, "jobs", log.Default())
	if err != nil {
		log.Fatalf("initialize queue store: %v", err)
	}
	dispatchStore := queue.NewStoreWithPool(store.Pool(), "whatsmeow_jobs", log.Default())

	dispatcher := service.NewDispatcher(dispatchStore, log.Default())
	consumer := channel.NewConsumer(store, dispatcher, cfg.PollInterval, cfg.MaxAttempts, log.Default())

	consumerErr := make(chan error, 1)
	go func() {
		consumerErr <- consumer.Run(ctx)
	}()

	// Wait for the consumer to stop or an OS signal, then shut down.
	select {
	case err := <-consumerErr:
		if err != nil {
			log.Printf("queue consumer stopped: %v", err)
		}
	case <-ctx.Done():
		log.Println("shutting down")
	}
	stop()

	store.Close()
}
