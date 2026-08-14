package ports

import (
	"context"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
)

// ActivityRecorder persists observability activity rows. The single Record
// method returns an error rather than swallowing it; callers decide whether to
// treat a failure as fatal (the worker records fire-and-forget, logging and
// continuing on error so observability never affects the forward path).
type ActivityRecorder interface {
	Record(ctx context.Context, event entity.ActivityEvent) error
}
