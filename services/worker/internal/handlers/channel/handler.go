// Package channel hosts the queue channel handler: it polls the queue store
// (ports.JobStore) and executes claimed jobs through the injected job handler.
// It is the handlers-layer root for the queue channel — it decides nothing, it
// only translates queue rows into job handler calls and applies the outcome
// the entity layer classifies.
package channel

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
)

// defaultPollInterval polls the queue when no interval is configured.
const defaultPollInterval = time.Second

// Consumer polls the queue store and executes claimed jobs through the
// injected job handler.
type Consumer struct {
	store               ports.JobStore
	handler             ports.JobHandler
	pollInterval        time.Duration
	maxAttemptsFallback int
	logger              *log.Logger
}

func NewConsumer(store ports.JobStore, handler ports.JobHandler, pollInterval time.Duration, maxAttemptsFallback int, logger *log.Logger) *Consumer {
	if logger == nil {
		logger = log.Default()
	}
	if pollInterval <= 0 {
		pollInterval = defaultPollInterval
	}
	if maxAttemptsFallback <= 0 {
		maxAttemptsFallback = entity.DefaultMaxAttempts
	}
	return &Consumer{
		store:               store,
		handler:             handler,
		pollInterval:        pollInterval,
		maxAttemptsFallback: maxAttemptsFallback,
		logger:              logger,
	}
}

// Run polls until ctx is canceled, returning nil on cancellation.
func (c *Consumer) Run(ctx context.Context) error {
	if c.store == nil {
		return fmt.Errorf("queue consumer: job store is nil")
	}
	if c.handler == nil {
		return fmt.Errorf("queue consumer: job handler is nil")
	}
	ticker := time.NewTicker(c.pollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			if err := c.processOnce(ctx); err != nil {
				c.logger.Printf("queue consumer: poll error: %v", err)
			}
		}
	}
}
