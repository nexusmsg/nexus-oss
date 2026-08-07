package ports

import (
	"context"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
)

// JobStore persists and mutates outbound jobs in the queue.
type JobStore interface {
	// Claim atomically claims up to limit pending jobs that are due.
	Claim(ctx context.Context, limit int) ([]entity.Job, error)
	// Enqueue inserts a job into the queue table and returns its serial. Used
	// to forward claimed jobs from the jobs table into whatsmeow_jobs.
	Enqueue(ctx context.Context, job entity.Job) (string, error)
	// Complete marks a job as succeeded with its result.
	Complete(ctx context.Context, serial string, result entity.JobResult) error
	// RetryLater returns a failed job to the pending queue.
	RetryLater(ctx context.Context, serial string, nextAvailableAt time.Time, lastErr error) error
	// Fail marks a job as permanently failed.
	Fail(ctx context.Context, serial string, lastErr error) error
}
