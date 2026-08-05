# Worker — DeviceManager

Dynamic, multi-account WhatsApp device provisioning. Source:
`services/worker/internal/adapters/whatsmeow/manager.go`, `actor.go`.

## Why dynamic

Sessions live in the `sessions` table (source of truth). Devices must be
created on demand — a session can be added or have its status changed at
runtime (pairing, logout) — so the old static `WABA_DEVICES` registry was
removed. The manager reconciles against the DB instead of a static list.

## Actor model

One manager goroutine + one actor goroutine per device. All state mutation
happens on the owner goroutine; cross-goroutine calls go through channels
(never shared locks).

```text
manager (single goroutine)
  ├─ command channel (ensure / pair / logout / get-sender / shutdown)
  └─ owns map[phoneNumberID]*actor
        actor ── whatsmeow client (owned by actor goroutine)
```

- `EnsureDevice(phoneNumberID)` — blocking until the actor exists and is ready
  (or an error); missing store row → `ErrDeviceNotFound`.
- `Pair(phoneNumberID)` — creates the actor if absent; calls `client.Pair()`
  (QR-based). Returns `ports.ErrAlreadyPaired` when the device already has a
  stored WhatsMeow session (idempotent success).
- `Logout(phoneNumberID)` — calls `client.Logout()`; the client becomes
  unusable and is re-provisioned by the next `EnsureDevice`.
- `ConnectStored()` — connects only devices with a stored WhatsMeow session
  (no QR at boot); skipped actors are reported at `SkippedDeviceSync`.
- `Sender(phoneNumberID)` — fast-path: active device lookup with a short
  timeout, error when missing (handlers then lazy-ensure).
- `Shutdown(ctx)` — cancel pair context → disconnect all → join actors.

## Lifecycle edge cases

- **Disconnect/LoggedOut event**: actor marks the device dead, stops the client,
  and the executor's next send triggers a fresh `EnsureDevice`.
- **Pairing QR refresh**: emitted via `PairChannel` callback through the
  command loop; the API polls a session-level QR buffer.
- **Boot without stored session**: device skipped; it is provisioned only when
  a pairing job runs or an outbound send needs it.
