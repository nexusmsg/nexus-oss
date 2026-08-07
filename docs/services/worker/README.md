# Worker — Go + WhatsMeow

WhatsApp message gateway, split into two binaries that communicate through the
`whatsmeow_jobs` queue table:

- `cmd/worker` — **stateless dispatcher**: polls `jobs`, forwards each job to
  `whatsmeow_jobs` (`source_job_serial` = original `jobs.serial`), leaves the
  `jobs` row `claimed`. No WhatsMeow state; horizontally scalable.
- `cmd/whatsapp_worker` — **stateful executor**: owns WhatsMeow clients and the
  `DeviceManager`, polls `whatsmeow_jobs`, executes each job, and writes the
  terminal status + result back to `jobs` via `source_job_serial`. Single
  instance.

Path: `services/worker/`

## Sections

| Section | Content |
|---------|---------|
| [architecture.md](architecture.md) | Layered hexagonal layout, two-binary runtime flow |
| [device-manager.md](device-manager.md) | Dynamic device provisioning + actor model |
| [channels.md](channels.md) | Channel inventory, flow diagrams, simplification analysis |
| [queue.md](queue.md) | Job store (jobs + whatsmeow_jobs), consumer, session store, heartbeat |
| [configuration.md](configuration.md) | Environment variables and defaults |
| [testing.md](testing.md) | Hermetic + live integration tests |

## Quick facts

- Language/stack: Go (module `github.com/afikrim/waba-api-unofficial`), WhatsMeow,
  pgx, golang-migrate.
- Two binaries, one schema: `jobs` (API-facing, polled for
  `result.wa_message_id`) and `whatsmeow_jobs` (worker-to-worker handoff,
  carries `source_job_serial` for result write-back).
- Devices are provisioned **from the `sessions` table** (single source of
  truth); the old static `WABA_DEVICES` registry was removed.
- `DeviceManager` uses an actor model: one manager goroutine + one goroutine
  per device, channel-based commands.
- Inbound events are anti-corrupted through `handler.go`, mapped to WABA
  payloads, and forwarded to the customer webhook with HMAC signing.
- Outbound sends are queue-driven: the API enqueues a `jobs` row, `cmd/worker`
  dispatches it to `whatsmeow_jobs`, `cmd/whatsapp_worker` executes it and
  writes the result back, completing with `result.wa_message_id`.

## Layout

```text
cmd/
  worker/           stateless dispatcher (jobs -> whatsmeow_jobs)
  whatsapp_worker/  stateful executor (whatsmeow_jobs -> jobs write-back)
  migrate/          golang-migrate runner
internal/
  config/           environment config (Load)
  core/domain/      event, job, outbound, session, webhook models
  core/ports/       DeviceManager, JobStore, JobHandler, SessionStore, senders, webhook...
  service/          dispatcher, whatsapp executor, message (WABA mapping), outbound validation
  adapters/
    whatsmeow/      manager, actor, client, handler
    queue/          store, consumer, session_store, heartbeat
    webhook/        HTTP forwarder + HMAC
    apiconfig/      webhook-config provider (TTL cache)
```

See [architecture.md](architecture.md) for the runtime flows.
