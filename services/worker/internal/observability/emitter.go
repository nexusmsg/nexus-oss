// Package observability provides the shared fire-and-forget activity emitter
// used by worker capture points.
package observability

import (
	"context"
	"log"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
)

// Emitter owns the fire-and-forget activity emission discipline. Capture points
// build an entity.ActivityEvent and call Emit; writes are detached from caller
// cancellation and recorder errors are logged and swallowed.
type Emitter struct {
	recorder ports.ActivityRecorder
	logger   *log.Logger
}

// NewEmitter wraps a recorder with the fire-and-forget emission discipline. A
// nil recorder is safe and results in a no-op emitter.
func NewEmitter(recorder ports.ActivityRecorder, logger *log.Logger) *Emitter {
	if logger == nil {
		logger = log.Default()
	}
	return &Emitter{recorder: recorder, logger: logger}
}

// Emit records the event asynchronously. It never blocks or returns an error.
func (e *Emitter) Emit(ctx context.Context, event entity.ActivityEvent) {
	if e == nil || e.recorder == nil {
		return
	}
	go func() {
		if err := e.recorder.Record(context.WithoutCancel(ctx), event); err != nil {
			e.logger.Printf("observability: record %s %s: %v", event.Type, event.Serial, err)
		}
	}()
}
