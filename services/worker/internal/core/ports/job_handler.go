package ports

import (
	"context"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
)

// JobHandler executes a single claimed job and returns its result.
type JobHandler interface {
	Handle(ctx context.Context, job entity.Job) (entity.JobResult, error)
}
