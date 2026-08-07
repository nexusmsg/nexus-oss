# Worker — Architecture

Follow `services/worker/AGENTS.md` for the authoritative layering rules.

## Layering

Dependency direction is one-way: `entity ← ports ← service ← adapters`,
with `cmd` as the composition root.

```text
cmd/worker/            stateless dispatcher composition root
cmd/whatsapp_worker/   stateful executor composition root (constructs the
                       whatsapp handler and injects it into DeviceManager)
cmd/migrate/           golang-migrate runner
   │
internal/core/entity/          internal models (no external imports)
internal/core/ports/           contracts (interfaces + sentinel errors)
internal/service/              use cases: dispatcher, whatsapp executor, message, validate
internal/handlers/             channel (queue consumer), whatsapp (inbound event handler)
internal/adapters/             whatsmeow, queue, webhook, apiconfig
```

Compile-time assertions (`var _ ports.X = (*Y)(nil)`) enforce the contracts.

## Two-binary runtime flow

The worker area is split into two binaries that communicate only through the
`whatsmeow_jobs` table. The API is untouched and still polls `jobs` for
terminal status + `result.wa_message_id`.

```text
API POST /:phone_number_id/messages -> jobs row (pending)
  -> cmd/worker: handlers/channel consumer claims the jobs row
       (FOR UPDATE SKIP LOCKED, marks it 'claimed')
  -> service/dispatcher.go: validate payload -> INSERT into whatsmeow_jobs
       with source_job_serial = jobs.serial -> return ports.ErrDispatched
  -> consumer leaves the jobs row 'claimed' (no Complete/Retry/Fail)
  -> cmd/whatsapp_worker: handlers/channel consumer claims the whatsmeow_jobs row
  -> service/whatsapp_executor.go: ensureDevice -> validate -> DeviceManager.Sender
       -> whatsmeow.SendMessage -> wamid
  -> executor writes back to jobs via source_job_serial:
       success  -> jobsStore.Complete(serial, {wa_message_id: wamid})
       terminal -> jobsStore.Fail(serial, err)   (attempts >= max_attempts)
       retry    -> jobs row stays 'claimed'
  -> consumer completes/fails/retries the whatsmeow_jobs row
  -> API polls jobs to terminal status and returns the official WABA 200 envelope
```

### Boot / provisioning (cmd/whatsapp_worker only)
1. `config.Load` → build `SessionStore`, `DeviceManager`, consumer, heartbeat.
2. Boot sync: `SessionStore.ListSessions()` → `DeviceManager.EnsureDevice` per
   session → `ConnectStored()` (connects only devices with a stored WhatsMeow
   session — no QR at boot).
3. Shutdown order: cancel signal ctx → stop consumer & heartbeat → manager
   shutdown (cancel pairCtx → disconnect → join actors) → container close →
   store close.

### Inbound (WhatsApp → customer webhook) — cmd/whatsapp_worker only
```text
WhatsMeow event
  -> handlers/whatsapp/handler.go (anti-corruption, unwrap; constructed in
     cmd/whatsapp_worker and injected into DeviceManager via EventHandlerFactory)
  -> entity.InboundEvent
  -> service/message.go (WABA payload construction, self-sent ignored)
  -> ports.WebhookConfigProvider (apiconfig, TTL cache)
     GET {API_URL}/internal/webhook-config?phone_number_id=...
  -> adapters/webhook/client.go (HMAC X-Hub-Signature-256, retry, 15s timeout)
  -> customer webhook endpoint
```

### Pairing / logout (job-driven, lazy) — cmd/whatsapp_worker
- Executor resolves the session first (`GetByPhoneNumberID`; null → job fails
  "session not found"), then `EnsureDevice`.
- `Pair` returns `ports.ErrAlreadyPaired` when the device already has a stored
  session — treated as idempotent success (no QR, status stays `created`).
- Logout deletes the WhatsMeow stored session; the device dies and is
  re-provisioned by the next `EnsureDevice`.

## Ports surface

| Port | Responsibility |
|------|----------------|
| `DeviceManager` | EnsureDevice, Pair, Logout, ConnectStored, ActiveDevices, Shutdown |
| `ActiveDeviceProvider` | `ActiveDevices() []string` (heartbeat dep, avoids full interface) |
| `OutboundSenderProvider` | `Sender(phoneNumberID)` fast-path |
| `SessionStore` | ListSessions, GetByPhoneNumberID, UpdateHeartbeats |
| `JobStore` / `JobHandler` | queue store (Claim/Enqueue/Complete/RetryLater/Fail) / handler contract |
| `MessageSender` / `MessageService` | per-device send / inbound boundary |
| `WebhookConfigProvider` / `WebhookForwarder` | config fetch / HMAC POST |

Sentinel errors: `ports.ErrDispatched` (handler forwarded the job to
`whatsmeow_jobs`; consumer leaves the row `claimed`) and `ports.ErrAlreadyPaired`
(idempotent pairing success).
