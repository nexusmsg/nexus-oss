package channel

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
)

// defaultClaimLimit claims up to this many jobs per poll.
const defaultClaimLimit = 10

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

// processJob executes one claimed job. Unknown job types fail immediately,
// before the handler runs; the outcome of handled jobs is classified by the
// entity layer and applied through the store.
func (c *Consumer) processJob(ctx context.Context, job entity.Job) error {
	if !isKnownJobType(job.Type) {
		err := fmt.Errorf("unknown job type %q", job.Type)
		if failErr := c.store.Fail(ctx, job.Serial, err); failErr != nil {
			return fmt.Errorf("fail job %s: %w", job.Serial, failErr)
		}
		c.logger.Printf("queue consumer: job %s: failed: %v", job.Serial, err)
		return nil
	}

	result, err := c.handler.Handle(ctx, job)
	return c.applyOutcome(ctx, job, result, err)
}

// isKnownJobType reports whether the consumer can execute the job type.
func isKnownJobType(jobType string) bool {
	switch jobType {
	case entity.JobTypeSendMessage, entity.JobTypePairing, entity.JobTypeLogout:
		return true
	default:
		return false
	}
}

// applyOutcome applies the entity-classified outcome through the job store. A
// dispatched job (ports.ErrDispatched) was forwarded to whatsmeow_jobs; the
// whatsapp worker writes the terminal status back to the jobs row later, so it
// is left 'claimed' rather than completing, retrying, or failing it here.
func (c *Consumer) applyOutcome(ctx context.Context, job entity.Job, result entity.JobResult, err error) error {
	if errors.Is(err, ports.ErrDispatched) {
		c.logger.Printf("queue consumer: job %s: dispatched to whatsmeow_jobs", job.Serial)
		return nil
	}
	switch entity.Classify(job, result, err, c.maxAttemptsFallback) {
	case entity.JobOutcomeComplete:
		if completeErr := c.store.Complete(ctx, job.Serial, result); completeErr != nil {
			return fmt.Errorf("complete job %s: %w", job.Serial, completeErr)
		}
		c.logger.Printf("queue consumer: job %s: completed", job.Serial)
	case entity.JobOutcomeRetry:
		nextAvailableAt := time.Now().Add(entity.BackoffForAttempt(job.Attempts))
		if retryErr := c.store.RetryLater(ctx, job.Serial, nextAvailableAt, err); retryErr != nil {
			return fmt.Errorf("retry job %s: %w", job.Serial, retryErr)
		}
		c.logger.Printf("queue consumer: job %s: retry scheduled for %s: %v", job.Serial, nextAvailableAt.Format(time.RFC3339), err)
	case entity.JobOutcomeFail:
		if failErr := c.store.Fail(ctx, job.Serial, err); failErr != nil {
			return fmt.Errorf("fail job %s: %w", job.Serial, failErr)
		}
		c.logger.Printf("queue consumer: job %s: failed after %d attempts: %v", job.Serial, job.Attempts, err)
	}
	return nil
}
