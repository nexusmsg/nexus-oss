package ports

import (
	"context"

	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
)

// JobHandler executes a single claimed job and returns its result.
type JobHandler interface {
	Handle(ctx context.Context, job domain.Job) (domain.JobResult, error)
}
