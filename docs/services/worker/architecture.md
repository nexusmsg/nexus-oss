# Worker — Architecture

Follow `services/worker/AGENTS.md` for the authoritative layering rules.

## Layering

Dependency direction is one-way: `domain ← ports ← service ← adapters`,
with `cmd` as the composition root.

```text
cmd/main.go                    compose, boot sync, shutdown
   │
internal/core/domain/          internal models (no external imports)
internal/core/ports/           contracts (interfaces + sentinel errors)
internal/service/              use cases: executor, message, outbound
internal/adapters/             whatsmeow, queue, webhook, apiconfig
```

Compile-time assertions (`var _ ports.X = (*Y)(nil)`) enforce the contracts.

## Runtime flows

### Boot / provisioning
1. `config.Load` → build `SessionStore`, `DeviceManager`, consumer, heartbeat.
2. Boot sync: `SessionStore.ListSessions()` → `DeviceManager.EnsureDevice` per
   session → `ConnectStored()` (connects only devices with a stored WhatsMeow
   session — no QR at boot).
3. Shutdown order: cancel signal ctx → stop consumer & heartbeat → manager
   shutdown (cancel pairCtx → disconnect → join actors) → container close →
   store close.

### Inbound (WhatsApp → customer webhook)
```text
WhatsMeow event
  -> adapters/whatsmeow/handler.go (anti-corruption, unwrap)
  -> domain.InboundEvent
  -> service/message.go (WABA payload construction, self-sent ignored)
  -> ports.WebhookConfigProvider (apiconfig, TTL cache)
     GET {API_URL}/internal/v1/webhook-config?phone_number_id=...
  -> adapters/webhook/client.go (HMAC X-Hub-Signature-256, retry, 15s timeout)
  -> customer webhook endpoint
```

### Outbound (API job → WhatsApp)
```text
API POST /:phone_number_id/messages -> jobs row (pending)
  -> adapters/queue consumer (Claim, FOR UPDATE SKIP LOCKED)
  -> service/executor.go: lazy ensureDevice (GetByPhoneNumberID ->
     DeviceManager.EnsureDevice; missing session fails job) -> validate
  -> DeviceManager.Sender(phone_number_id) -> per-device send queue
  -> whatsmeow.SendMessage
  -> Complete with result: {"wa_message_id": "<real wamid>"}
  -> API polls result and returns the official WABA 200 envelope
```

### Pairing / logout (job-driven, lazy)
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
| `JobStore` / `JobHandler` | queue store / executor contract |
| `MessageSender` / `MessageService` | per-device send / inbound boundary |
| `WebhookConfigProvider` / `WebhookForwarder` | config fetch / HMAC POST |
