# Worker — Go + WhatsMeow

WhatsApp message gateway: WhatsMeow events → WABA webhook payloads, outbound
send execution, Supabase queue consumer, and the dynamic multi-account
`DeviceManager`.

Path: `services/worker/`

## Sections

| Section | Content |
|---------|---------|
| [architecture.md](architecture.md) | Layered hexagonal layout, runtime flow |
| [device-manager.md](device-manager.md) | Dynamic device provisioning + actor model |
| [channels.md](channels.md) | Channel inventory, flow diagrams, simplification analysis |
| [queue.md](queue.md) | Job store, consumer, session store, heartbeat |
| [configuration.md](configuration.md) | Environment variables and defaults |
| [testing.md](testing.md) | Hermetic + live integration tests |

## Quick facts

- Language/stack: Go (module `github.com/afikrim/waba-api-unofficial`), WhatsMeow,
  pgx, golang-migrate.
- Devices are provisioned **from the `sessions` table** (single source of
  truth); the old static `WABA_DEVICES` registry was removed.
- `DeviceManager` uses an actor model: one manager goroutine + one goroutine
  per device, channel-based commands.
- Inbound events are anti-corrupted through `handler.go`, mapped to WABA
  payloads, and forwarded to the customer webhook with HMAC signing.
- Outbound sends are queue-driven: the API enqueues a job, the worker claims
  and executes it, completing with `result.wa_message_id`.

## Layout

```text
cmd/
  main.go           composition root (boot sync, shutdown ordering)
  migrate/main.go   golang-migrate runner
internal/
  config/           environment config (Load)
  core/domain/      event, job, outbound, session, webhook models
  core/ports/       DeviceManager, JobStore, SessionStore, senders, webhook...
  service/          executor, message (WABA mapping), outbound validation
  adapters/
    whatsmeow/      manager, actor, client, handler
    queue/          store, consumer, session_store, heartbeat
    webhook/        HTTP forwarder + HMAC
    apiconfig/      webhook-config provider (TTL cache)
```

See [architecture.md](architecture.md) for the runtime flows.
