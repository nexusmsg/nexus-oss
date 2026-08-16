# Plan: Unify Worker Activity Emission via a Shared Fire-and-Forget Emitter

## Objective

Replace the **three duplicated** fire-and-forget emission sites in the worker
(each with its own inline `go func() { recorder.Record(context.WithoutCancel(ctx), …) }()`
plus nil-guard and log-and-swallow) with a **single shared emitter** — the Go
analog of the dashboard's centralized `void record().catch(log)` discipline
(`observability-capture/record.ts`, plan §10 R3). Capture points keep building
their `entity.ActivityEvent` payloads (serial app-side, per the linking
contract) but delegate emission plumbing to one `Emitter`. **Behavior, row
shape, and DB writes are unchanged.**

This is NOT the dashboard `authz(time(obs(handler)))` wrapper pattern ported
1:1 — see "Why not a wrapper" below.

## Why not a wrapper (design decision)

The dashboard can wrap its one seam (route handler) because it emits **one**
event type (`api_request`) through **one** entry point. The worker emits
**three** heterogeneous event types at **three** different seams:

| Capture point | Type | Seam |
|---|---|---|
| `whatsapp_event` | `ActivityTypeWhatsAppEvent` | `handler.go:recordWhatsappEvent` — before forwarding; serial must exist **synchronously** for `source_activity_serial` linking |
| `webhook_delivery` (attempted) | `ActivityTypeWebhookDelivery` | `message.go:recordDeliveryAttempt` — **inside** the retry loop, once per attempt |
| `webhook_delivery` (terminal) | `ActivityTypeWebhookDelivery` | `message.go:recordDeliveryTerminal` — after the loop |
| `webhook_delivery` (send outcome) | `ActivityTypeWebhookDelivery` | `whatsapp_executor.go:recordSendOutcome` — after a send |

A single wrapper cannot produce these: payloads, statuses, and correlation
fields differ per seam, and the per-attempt rows live mid-loop. What **is**
worth mirroring from the API is the *emission plumbing* — goroutine spawn,
`context.WithoutCancel` detach, nil-recorder no-op, log-and-swallow of recorder
errors. Today that plumbing is copy-pasted three times; the plan centralizes it.

## Context (files to know)

- Port: `internal/core/ports/activity_recorder.go` → `Record(ctx, event) error`
- Entity: `internal/core/entity/activity.go` → `ActivityEvent`; app-generated `Serial`
- Adapter (DO NOT change): `internal/adapters/activity/store.go` — implements the port
- Capture sites:
  - `internal/handlers/whatsapp/handler.go` — field `recorder` (27), `NewHandler` (34-46), `recordWhatsappEvent` (54-77, inline goroutine)
  - `internal/service/message.go` — field `recorder` (33), `NewMessage` (42-47), `recordDeliveryAttempt` (174-198), `recordDeliveryTerminal` (203-240), `fireRecord` (245-254, the one shared helper in this file)
  - `internal/service/whatsapp_executor.go` — field `recorder` (26), `NewWhatsAppExecutor` (40-45), `recordSendOutcome` (203-246, inline goroutine)
- Wiring: `cmd/whatsapp_worker/main.go` — `activityStore` created at 66, passed to `NewMessage` (67), `NewHandler` (72), `NewWhatsAppExecutor` (94)
- Tests:
  - `internal/service/observability_test.go` — `newTestMessage` (18-24, `NewMessage` at 19), `newTestExecutorWithRecorder` (278-291, `NewWhatsAppExecutor` at 290), `waitForRecorded` (265-273) already polls the fake goroutines
  - `internal/handlers/whatsapp/handler_test.go` — `NewHandler` at 36 and 79; package-local `fakeActivityRecorder` (101-119); `waitForRecorded` (121-129)
  - `internal/service/fakes_test.go` — `fakeActivityRecorder` (379-405); `NewWhatsAppExecutor(..., nil, nil)` at 362
- Reference (already shipped): dashboard `observability-capture/record.ts` fire-and-forget discipline

## Architecture

### New package: `internal/observability/emitter.go`

Peer of `core/`/`service/`/`adapters/`/`handlers/`, depending **only** on
`core/entity` + `core/ports` + stdlib (`context`, `log`). Keeps the one-way
dependency direction intact: `service` and `handlers` may import it; it must
not import adapters.

```go
// Package observability provides the shared fire-and-forget activity emitter
// used by worker capture points. It centralizes the emission discipline that
// the dashboard side keeps in its observability capture wrapper (plan §10 R3):
// emission never blocks, never fails, and never couples the forward path to the
// activity store.
package observability

import (
	"context"
	"log"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
)

// Emitter owns the fire-and-forget activity emission discipline. Capture points
// build an entity.ActivityEvent (with an app-generated serial, so callers can
// link source_activity_serial without awaiting the write) and call Emit; the
// Emitter runs the write in a goroutine detached from the caller's cancellation
// and swallows recorder errors, so observability can never affect the forward
// path.
type Emitter struct {
	recorder ports.ActivityRecorder
	logger   *log.Logger
}

// NewEmitter wraps a ports.ActivityRecorder with the fire-and-forget emission
// discipline. A nil recorder or logger is safe: the emitter degrades to a
// no-op.
func NewEmitter(recorder ports.ActivityRecorder, logger *log.Logger) *Emitter {
	if logger == nil {
		logger = log.Default()
	}
	return &Emitter{recorder: recorder, logger: logger}
}

// Emit records the event fire-and-forget. It never blocks and never returns an
// error: the write runs in a goroutine detached from ctx cancellation, and a
// recorder failure is logged and swallowed.
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
```

### Semantics preserved

- Serial generation stays **app-side at each capture point** (linking contract
  §10 R3) — the Emitter never invents serials.
- `context.WithoutCancel(ctx)` detach stays (a device disconnect that cancels
  the inbound ctx must not drop the write).
- `Emit` is nil-safe on both a nil `*Emitter` **and** a wrapped nil recorder —
  `TestHandlerNilRecorderNoEventRow` keeps passing.
- Log line format becomes the uniform
  `observability: record <type> <serial>: <err>` (slightly different per-site
  today: `whatsapp_event`/`send outcome`/generic — acceptable unification).

## Change inventory

### 1. New file — `internal/observability/emitter.go`

Exactly the code above (new package).

### 2. `internal/handlers/whatsapp/handler.go`

- Field `recorder ports.ActivityRecorder` → `emitter *observability.Emitter`.
- `NewHandler`: param `recorder ports.ActivityRecorder` → `emitter *observability.Emitter`; struct literal `recorder:` → `emitter:`; update doc comment (emitter is optional and nil-safe).
- `recordWhatsappEvent` (54-77): keep `serial := uuid.New()`, keep payload/`ActivityEvent` construction; **delete** the `if h.recorder == nil` guard and the inline goroutine; call `h.emitter.Emit(ctx, record)`. Returns serial unchanged.
- Add import `"github.com/afikrim/waba-api-unofficial/internal/observability"`.

### 3. `internal/service/message.go`

- Field `recorder ports.ActivityRecorder` → `emitter *observability.Emitter`.
- `NewMessage`: param `recorder` → `emitter`; struct literal update; update stale doc comment ("stored for use by capture points added in a later task" is no longer true).
- `recordDeliveryAttempt` / `recordDeliveryTerminal`: **delete** the `if s.recorder == nil { return }` guard; replace `s.fireRecord(ctx, eventRecord)` with `s.emitter.Emit(ctx, eventRecord)`.
- **Delete** `fireRecord` (245-254).
- Add import for `internal/observability`.
- `context` remains used elsewhere (Inbound, forwardWebhookWithRetry) — keep import.

### 4. `internal/service/whatsapp_executor.go`

- Field `recorder ports.ActivityRecorder` → `emitter *observability.Emitter`.
- `NewWhatsAppExecutor`: param `recorder` → `emitter`; struct literal update; update stale doc comment.
- `recordSendOutcome` (203-246): **delete** the `if e.recorder == nil` guard and the trailing inline goroutine; call `e.emitter.Emit(ctx, event)`; update doc comment to reference the Emitter.
- Add import for `internal/observability`.

### 5. `cmd/whatsapp_worker/main.go`

- After line 66 (`activityStore := activity.New(...)`), add:
  `emitter := observability.NewEmitter(activityStore, log.Default())`
- Line 67 `NewMessage(..., activityStore)` → `NewMessage(..., emitter)`.
- Line 72 `NewHandler(..., activityStore, logger)` → `NewHandler(..., emitter, logger)`.
- Line 94 `NewWhatsAppExecutor(..., activityStore, ...)` → `NewWhatsAppExecutor(..., emitter, ...)`.
- Add import `"github.com/afikrim/waba-api-unofficial/internal/observability"`.
- `activityStore` is still needed (it's what the Emitter wraps) — keep the line.

### 6. Tests

- `internal/service/observability_test.go`:
  - `newTestMessage` (19): `NewMessage(..., recorder)` →
    `NewMessage(..., observability.NewEmitter(recorder, log.Default()))`.
  - `newTestExecutorWithRecorder` (290): `NewWhatsAppExecutor(..., recorder, ...)` →
    `NewWhatsAppExecutor(..., observability.NewEmitter(recorder, log.Default()), ...)`.
  - Add import for `internal/observability`. All assertions (`waitForRecorded`,
    payload shapes, source links) stay exactly as-is — the Emitter still writes
    through the same fake asynchronously.
- `internal/handlers/whatsapp/handler_test.go`:
  - Line 36: `NewHandler(..., recorder, nil)` →
    `NewHandler(..., observability.NewEmitter(recorder, nil), nil)`.
  - Line 79 (nil recorder): `NewHandler(..., nil, nil)` → **unchanged**
    (a nil `*observability.Emitter` is still a no-op and the serial is still
    generated — `TestHandlerNilRecorderNoEventRow` keeps passing).
  - Add import for `internal/observability`.
- **No changes needed** in `message_test.go` or `fakes_test.go`: their
  `NewMessage`/`NewWhatsAppExecutor` calls already pass `nil` for the recorder
  arg, which stays a valid nil `*observability.Emitter`.

## Implementation order

1. `internal/observability/emitter.go` (new package).
2. `internal/service/message.go` (fields, constructor, capture sites, delete `fireRecord`).
3. `internal/service/whatsapp_executor.go`.
4. `internal/handlers/whatsapp/handler.go`.
5. `cmd/whatsapp_worker/main.go` wiring.
6. Test constructor updates (2 files).
7. Verify (below).

## Definition of done / verification

- `gofmt -l .` → no output.
- `go vet ./...` → clean.
- `go test ./...` from `services/worker/` → **174 tests in 19 packages pass**
  (existing observability tests already prove row shape, source links, retry
  budget, and the recorder-failure-never-breaks-forward contract; no test
  semantics change).
- No behavioral drift: row shape, statuses, serials, `source_activity_serial`
  links, and `context.WithoutCancel` semantics are identical.

## Out of scope

- Dashboard `authz(time(obs(handler)))` refactor — already implemented (new
  `authz.ts`/`handler.ts`/`obs.ts`/`envelopes.ts`/`time.ts` exist, old
  `observability-capture.ts` deleted).
- `internal/adapters/activity/store.go` (port impl), the `activity_events`
  migration, and the API observability routes.
- Adding a buffer/queue/batch flush in front of the Emitter (possible future
  work — the Emitter is the single seam that would grow it).
