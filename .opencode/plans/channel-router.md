# Channel Router Refactor Plan

## Objective

Unify the worker's "messed up" dual routing (actor lifecycle channel vs.
mutex-map send path) into a single named-route dispatcher backed by per-route
bounded queues and worker goroutines. The channel router acts like HTTP
routing for the worker's internal flows.

## Background

The worker currently has two unrelated dispatch models for the same device:

- **Lifecycle** routes through `deviceRef.lifecycle` (chan + actor goroutine).
- **Sends** route through `DeviceManager.devices[id]` map → `*Client.Send`
  (mutex), called directly on the consumer goroutine.

Sends bypass the actor, so lifecycle and send paths can race. The consumer
processes claimed jobs sequentially, so there is no per-device parallelism and
the per-device `sendMu` is effectively redundant. The handoff and plans
advertise a "bounded per-device send channel + worker goroutine" that was never
built.

## Ports vs. Concrete Adapters (rule)

An adapter gets a port only for the side consumed by business logic:

- **Send / dispatch side** (producers push messages/commands *into* a channel)
  → port. `ports.ChannelDispatcher` is consumed by the executor / message
  service to dispatch.
- **Receive / handler side** (handlers *receive from* a channel) → no port.
  `channel.Handler`, `channel.Channel`, and `channel.Router` are concrete in
  `internal/adapters/channel/`, like HTTP handlers.

## Milestones

### M0 — Channel router scaffolding (this milestone)

Status: In progress

- `internal/core/ports/channel.go` — `ChannelDispatcher` port (send side).
- `internal/adapters/channel/channel.go` — concrete `Router` (implements
  `ports.ChannelDispatcher`), `Channel` (named route + bounded queue + worker
  goroutine), `Handler` (receive-side func). Bounded backpressure
  (`DefaultQueueSize = 32`), graceful drain on shutdown, ctx-aware dispatch.
- `internal/adapters/channel/channel_test.go` — register/dispatch/unknown/
  duplicate/after-run/before-run/canceled-ctx/backpressure/shutdown-drain/
  run-twice/concurrent.
- `services/worker/AGENTS.md` — document the send/receive port rule.

Acceptance: `gofmt`, `go build`, `go test`, `go vet` clean in
`services/worker`. Router is not yet wired into the runtime.

### M1 — Route inventory and naming

- Define the named routes the worker will dispatch through. Candidate set:
  - `inbound.event` — WhatsMeow event → message service (currently
    `handler.go` → `MessageService.Inbound` direct call).
  - `outbound.send` — claimed send job → per-device send (currently executor
    → `sender.Send` direct).
  - `device.pair` — pairing job → actor pair (currently executor →
    `manager.Pair`).
  - `device.logout` — logout job → actor logout.
  - `device.connect` — reconnect wakeup (currently `wakeup()` into
    `ref.lifecycle`).
- Decide per-route message envelope types (typed structs vs. `any`).

### M2 — Wire inbound through the router

- Register `inbound.event` handler that calls `MessageService.Inbound`.
- `handler.go` dispatches `domain.InboundEvent` to the router instead of
  calling the service directly.
- Keep the anti-corruption boundary: WhatsMeow types stay in the adapter.

### M3 — Wire outbound send through the router

- Register `outbound.send` handler per device (or a single handler that
  resolves the device by `phone_number_id`).
- Executor dispatches send jobs to the router; the handler calls `SendMessage`
  and completes/retries the job.
- This replaces the direct `sender.Send` call and gives per-device
  backpressure + parallelism.

### M4 — Unify lifecycle under the router

- Replace `deviceRef.lifecycle` chan with router routes `device.pair`,
  `device.logout`, `device.connect`.
- The actor becomes a set of registered handlers, or the actor goroutine
  becomes the worker for its routes.
- Remove the now-redundant `sendMu` once sends flow through the router.

### M5 — Retire dead code and sync docs

- Remove `service.Outbound` (unused since the Echo adapter was removed) if
  still unreferenced.
- Update `HANDOFF.md` and `services/worker/AGENTS.md` to match the new
  single-dispatcher model.
- Update the runtime flow diagram.

## Verification

Per milestone, run from `services/worker/`:

```bash
gofmt -w <changed-go-files>
go test ./...
go vet ./...
```

Integration tests against the compose stack where a milestone changes runtime
behavior.

## Verification Log

| Date | Command | Result |
| ---- | ------- | ------ |
| 2026-08-06 | `gofmt -w` on new files | clean |
| 2026-08-06 | `go build ./...` (services/worker) | success |
| 2026-08-06 | `go vet ./...` (services/worker) | no issues |
| 2026-08-06 | `go test ./... -race -count=1` (services/worker) | 101 passed (12 packages); channel: 13 passed |