package observability

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
	"github.com/google/uuid"
)

type recordingActivityRecorder struct {
	called chan struct{}
	err    error
	ctxErr chan error
}

func (r *recordingActivityRecorder) Record(ctx context.Context, _ entity.ActivityEvent) error {
	r.ctxErr <- ctx.Err()
	close(r.called)
	return r.err
}

func TestEmitterEmit_DetachesContextAndRecordsAsynchronously(t *testing.T) {
	recorder := &recordingActivityRecorder{
		called: make(chan struct{}),
		ctxErr: make(chan error, 1),
	}
	emitter := NewEmitter(recorder, nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	emitter.Emit(ctx, entity.ActivityEvent{Serial: uuid.New(), Type: entity.ActivityTypeWhatsAppEvent})

	select {
	case <-recorder.called:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for asynchronous record")
	}
	if err := <-recorder.ctxErr; err != nil {
		t.Fatalf("record context error = %v, want nil", err)
	}
}

func TestEmitterEmit_SwallowsRecorderError(t *testing.T) {
	recorder := &recordingActivityRecorder{
		called: make(chan struct{}),
		err:    errors.New("recorder failed"),
		ctxErr: make(chan error, 1),
	}

	NewEmitter(recorder, nil).Emit(context.Background(), entity.ActivityEvent{Serial: uuid.New()})

	select {
	case <-recorder.called:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for asynchronous record")
	}
}

func TestEmitterEmit_NilEmitterAndRecorderAreNoOps(t *testing.T) {
	var nilEmitter *Emitter
	nilEmitter.Emit(context.Background(), entity.ActivityEvent{})
	NewEmitter(nil, nil).Emit(context.Background(), entity.ActivityEvent{})
}
