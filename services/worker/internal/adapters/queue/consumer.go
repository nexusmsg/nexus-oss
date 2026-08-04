package queue

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
)

const (
	defaultPollInterval = time.Second
	defaultClaimLimit   = 10
	defaultMaxAttempts  = 3
	baseBackoff         = time.Second
	maxBackoff          = 30 * time.Second
)

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
		maxAttemptsFallback = defaultMaxAttempts
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

func (c *Consumer) processOnce(ctx context.Context) error {
	jobs, err := c.store.Claim(ctx, defaultClaimLimit)
	if err != nil {
		return fmt.Errorf("claim jobs: %w", err)
	}
	for _, job := range jobs {
		if err := c.processJob(ctx, job); err != nil {
			c.logger.Printf("queue consumer: job %s: %v", job.Serial, err)
		}
	}
	return nil
}

func (c *Consumer) processJob(ctx context.Context, job domain.Job) error {
	switch job.Type {
	case domain.JobTypeSendMessage, domain.JobTypePairing, domain.JobTypeLogout:
		// handled below
	default:
		err := fmt.Errorf("unknown job type %q", job.Type)
		if failErr := c.store.Fail(ctx, job.Serial, err); failErr != nil {
			return fmt.Errorf("fail job %s: %w", job.Serial, failErr)
		}
		c.logger.Printf("queue consumer: job %s: failed: %v", job.Serial, err)
		return nil
	}

	result, err := c.handler.Handle(ctx, job)
	if err == nil {
		if completeErr := c.store.Complete(ctx, job.Serial, result); completeErr != nil {
			return fmt.Errorf("complete job %s: %w", job.Serial, completeErr)
		}
		c.logger.Printf("queue consumer: job %s: completed", job.Serial)
		return nil
	}

	effectiveMax := c.maxAttemptsFallback
	if job.MaxAttempts > 0 {
		effectiveMax = job.MaxAttempts
	}
	if job.Attempts >= effectiveMax {
		if failErr := c.store.Fail(ctx, job.Serial, err); failErr != nil {
			return fmt.Errorf("fail job %s: %w", job.Serial, failErr)
		}
		c.logger.Printf("queue consumer: job %s: failed after %d attempts: %v", job.Serial, job.Attempts, err)
		return nil
	}

	nextAvailableAt := time.Now().Add(backoffForAttempt(job.Attempts))
	if retryErr := c.store.RetryLater(ctx, job.Serial, nextAvailableAt, err); retryErr != nil {
		return fmt.Errorf("retry job %s: %w", job.Serial, retryErr)
	}
	c.logger.Printf("queue consumer: job %s: retry scheduled for %s: %v", job.Serial, nextAvailableAt.Format(time.RFC3339), err)
	return nil
}

// backoffForAttempt returns the exponential backoff for an attempt count,
// starting at 1s for the first attempt and capped at 30s.
func backoffForAttempt(attempts int) time.Duration {
	if attempts <= 0 {
		attempts = 1
	}
	backoff := baseBackoff << (attempts - 1)
	if backoff > maxBackoff {
		backoff = maxBackoff
	}
	return backoff
}
