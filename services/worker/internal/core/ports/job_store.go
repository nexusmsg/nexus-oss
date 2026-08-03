package ports

import (
	"context"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
)

// JobStore persists and mutates outbound jobs in the queue.
type JobStore interface {
	// Claim atomically claims up to limit pending jobs that are due.
	Claim(ctx context.Context, limit int) ([]domain.Job, error)
	// Complete marks a job as succeeded with its result.
	Complete(ctx context.Context, serial string, result domain.JobResult) error
	// RetryLater returns a failed job to the pending queue.
	RetryLater(ctx context.Context, serial string, nextAvailableAt time.Time, lastErr error) error
	// Fail marks a job as permanently failed.
	Fail(ctx context.Context, serial string, lastErr error) error
}
