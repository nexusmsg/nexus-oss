# Handoff Notes
# Handoff Notes

## Monorepo Restructure (M1)

The project is now a Turborepo monorepo:

- `apps/` — UI placeholder (`.gitkeep` only).
- `services/api/` — Node.js Hono API scaffold; enqueue + synchronous result
  wait and internal webhook-config API land in later milestones.
- `services/worker/` — this Go worker (this document now lives here).
- `shared/db/migrations/` — golang-migrate SQL migrations (M2).
- Root `package.json` + `turbo.json` orchestrate every package.

Root commands: `npm install`, then `npm run dev` / `npm run build` /
`npm run test` (Turborepo). This document is now relative to
`services/worker/`; references such as `../../.opencode/plans/` and
`../../README.md` point back to the repo root.


## Migrations (M2)

- Schema migrations live in `../../shared/db/migrations/` (golang-migrate
  format): `000001_create_jobs`, `000002_create_webhook_configs`.
- `cmd/migrate` applies them: `SUPABASE_DSN=... go run ./cmd/migrate
  -direction up` (also `down [-steps N]` and `version`). `MIGRATIONS_DIR`
  defaults to `../../shared/db/migrations`.
- Table convention: `id bigserial` (counter only), `serial uuid unique` (used
  for all relationships/updates), `created_at`, `updated_at` (trigger-maintained),
  `deleted_at` (soft delete).
- Verified against a throwaway postgres:16 container: up → v2, idempotent,
  down 1 step → v1, up → v2.

## Dev Environment (M3)

- Full local stack via `docker-compose.yml` at the repo root.
- Services: `postgres` (16-alpine, host port **5433** — 5432 is taken by the local nexus-postgres), `postgrest` (port 3001), one-shot `migrate` (worker image, `/app/migrate -direction up`), `api` (port 3000), `worker`.
- Both app images build from the **repo root context**; worker image bundles `shared/db/migrations/` to `/app/migrations` and builds `CGO_ENABLED=0` binaries (`/app/worker`, `/app/migrate`).
- Store: WhatsMeow device store is Postgres (`WHATSMEOW_STORE_DSN`, falls back to `SUPABASE_DSN`); `lib/pq` driver, no CGO.
- Postgres DSNs in compose use `?sslmode=disable` (dev-only); PostgREST JWT secret default is >=32 bytes.
- Copy `.env.example` to `.env` to override; the stack also runs with defaults.
- Up: `docker compose up --build -d`. Verify: `curl localhost:3000/` returns `{"ok":true,"service":"api"}`, postgrest on 3001, `schema_migrations` version 2.

## Current Status

The worker now runs the M5 architecture:

- **Multi-device WhatsMeow registry** keyed by `phone_number_id`; each device
  owns a bounded outbound send queue and its own QR/reconnect loop.
- **Queue consumer** (pgx): polls `jobs`, claims with `FOR UPDATE SKIP LOCKED`,
  completes with `result: {"wa_message_id": "<real wamid>"}`, retries with
  exponential backoff, fails after max attempts.
- **Outbound executor** (service layer): claimed job → sender for the job's
  `phone_number_id` → validate → `ports.MessageSender` → real wamid.
- **Webhook config provider** (`apiconfig`): before forwarding an inbound
  event, fetches `GET {API_URL}/internal/webhook-config?phone_number_id=...`
  (Bearer `INTERNAL_TOKEN`, per-ID TTL cache); payloads are forwarded with the
  returned secret (HMAC) and a bounded non-2xx retry.
- The legacy Echo HTTP adapter (`internal/adapters/httpapi/`) was **removed**
  along with `PORT`/`API_AUTH_TOKEN` worker config — the API owns the HTTP
  surface now.

Latest commit: M5 (see the verification log in
`../../.opencode/plans/split-architecture.md`).

Verification at this handoff:

```text
go test ./...   58 passed (10 packages)
go vet ./...   passed
CGO_ENABLED=0 go build ./...   passed
```

## API Surface (M4, for M5 worker wiring)

`services/api` now exposes the two endpoints the worker consumes/produces:

- `POST /:phone_number_id/messages` — bearer auth (`API_AUTH_TOKEN`), WABA validation (mirrors `service/outbound.go`), optional idempotency key (header wins over body), enqueues a `send_message` job, polls the job row until `SEND_TIMEOUT_MS` (default 25000) every `RESULT_POLL_MS` (default 250), returns the official WABA 200 envelope with the real `wamid` from `result.wa_message_id`, or a WABA error envelope (504 on timeout).
- `GET /internal/webhook-config?phone_number_id=...` — bearer auth (`INTERNAL_TOKEN`), returns `{ webhook_url, webhook_secret }` (secret null-able); 404 when absent.

Env: `PORT`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `API_AUTH_TOKEN`, `INTERNAL_TOKEN`, `SEND_TIMEOUT_MS`, `RESULT_POLL_MS`.

**M5 contract:** the queue consumer must complete succeeded jobs with `result: { "wa_message_id": "<real wamid>" }` (the API reads this exact key). Source: `services/api/src/{app,transport,config}.ts`.

## Runtime Flow

```text
WhatsMeow event
  -> internal/adapters/whatsmeow/handler.go (per-device)
  -> domain.InboundEvent
  -> internal/service/message.go
  -> WABA payload construction
  -> payload log
  -> ports.WebhookConfigProvider (apiconfig, TTL cache)
     GET {API_URL}/internal/webhook-config?phone_number_id=...
  -> internal/adapters/webhook/client.go (HMAC with returned secret,
     bounded non-2xx retry)
  -> customer webhook endpoint

Outbound job
  API POST /:phone_number_id/messages -> jobs row (pending)
  -> internal/adapters/queue consumer (Claim, FOR UPDATE SKIP LOCKED)
  -> internal/service/executor.go: unmarshal payload -> validate
  -> whatsmeow.Registry.Sender(phone_number_id) -> per-device bounded
     send queue -> whatsmeow.SendMessage
  -> Complete with result: {"wa_message_id": "<real wamid>"}
  -> API polls result and returns the official WABA 200 envelope
```

## Implemented Behavior

- WhatsMeow's default stdout logger is disabled with `waLog.Noop`.
- Incoming message events are logged with message ID, sender, raw type, and
  `from_me` status.
- Supported mappings currently include conversation text, extended text,
  location, reaction, button reply, list reply, and message context.
- Self-sent messages (`IsFromMe`) are ignored.
- WABA payload metadata comes from `BUSINESS_ACCOUNT_ID` (global) and per-device
  `phone_number_id` + display number from `WABA_DEVICES`.
- The service logs the final JSON payload before forwarding it.
- Forwarding uses HTTP POST with `Content-Type: application/json`.
- The webhook URL/secret come from the API (`apiconfig` provider, per-ID TTL
  cache, default 30s); the secret produces `X-Hub-Signature-256` HMAC-SHA256
  over the exact JSON request body.
- Non-2xx responses are returned as errors and retried (3 attempts, short
  backoff).
- Requests use a 15-second HTTP client timeout and propagate the inbound
  context.
- Empty `webhook_url` from the API config disables forwarding while payload
  logging continues.
- Shutdown uses `signal.NotifyContext`: the poll loop stops, per-device send
  queues are drained, and every WhatsMeow client disconnects.
- Multi-device: one `whatsmeow.Client` per `phone_number_id` (`Registry`),
  each with its own bounded outbound queue (32) and worker goroutine; QR
  login and reconnect (bounded backoff) are handled per device.
- Outbound jobs are claimed from Postgres with `FOR UPDATE SKIP LOCKED`,
  executed through the per-device queue, completed with the real wamid in
  `result.wa_message_id`, retried with exponential backoff, and failed after
  `max_attempts`.

## Configuration

Set these environment variables before running:

```bash
BUSINESS_ACCOUNT_ID="your-business-account-id"
WABA_DEVICES="1001:628123456789,1002:628987654321"   # phone_number_id:number pairs
API_URL="http://localhost:3000"
INTERNAL_TOKEN="matches-api-INTERNAL_TOKEN"
POLL_INTERVAL="1s"          # queue poll interval (default 1s)
MAX_ATTEMPTS="3"            # retry ceiling (default 3)
WEBHOOK_CONFIG_TTL="30s"    # webhook-config cache TTL (default 30s)
SUPABASE_DSN="postgresql://user:pass@host:5432/waba?sslmode=disable"  # jobs DB
WHATSMEOW_STORE_DSN="postgresql://user:pass@host:5432/waba?sslmode=disable"  # device store (falls back to SUPABASE_DSN)
MIGRATIONS_DIR="../../shared/db/migrations"
```

Run the application with:

```bash
go run ./cmd
```

`WABA_DEVICES` is a comma-separated list of `phone_number_id:number` pairs; the
display phone defaults to the number. Malformed entries fail startup. The
worker no longer reads `PORT`, `API_AUTH_TOKEN`, `PHONE_NUMBER_ID`,
`DISPLAY_PHONE_NUMBER`, `WEBHOOK_URL`, or `WEBHOOK_SECRET` — webhook
destinations now come from the API's internal webhook-config endpoint.

## Important Decisions

- WhatsMeow-specific types stay inside the WhatsMeow adapter.
- WABA payload construction stays in the service layer.
- `WebhookForwarder` is a port and the HTTP client is its adapter; the message
  service resolves the destination per event via `WebhookConfigProvider`
  instead of static config.
- `MessageSender` is a port and each WhatsMeow `Client` implements it with a
  channel-backed per-device worker; `Registry` resolves senders by
  `phone_number_id` and implements `OutboundSenderProvider`.
- `JobStore` (pgx, SKIP LOCKED) and `JobHandler` (service executor) keep the
  consumer loop decoupled from business logic; retry/backoff policy lives in
  the consumer.
- Domain types do not import WhatsMeow or HTTP packages.
- Payload fields that cannot be reconstructed are omitted rather than
  invented.
- `entry[].id` comes from `BUSINESS_ACCOUNT_ID`; it cannot be derived from a
  normal WhatsApp sender number.
- `config` stays dependency-free: `WABA_DEVICES` parses into `config.Device`;
  `cmd/main.go` maps it to `whatsmeow.DeviceSpec`.

## Deferred Work

The following are intentionally not implemented yet:

- Internal media ID generation.
- Media descriptor persistence.
- Media download endpoints such as `GET /media/{media_id}`.
- Temporary download tokens and binary streaming.
- Contacts VCard parsing into the official WABA contact schema.
- Poll payload mapping.
- Native-flow `InteractiveResponseMessage` mapping.
- Full media mappings for image, video, audio, document, and sticker messages.

Do not invent schemas or media IDs for these types without first updating
`docs/api-mapping-webhook.md` and `../../.opencode/plans/waba-webhook-mapping.md`.

## Relevant Files

- `AGENTS.md`: repository architecture and implementation rules.
- `docs/api-mapping-webhook.md`: source mapping specification.
- `../../.opencode/plans/waba-webhook-mapping.md`: milestone and verification tracker.
- `internal/adapters/whatsmeow/handler.go`: raw WhatsMeow event translation.
- `internal/adapters/whatsmeow/client.go`: per-device WhatsMeow lifecycle, send
  queue, and reconnect loop.
- `internal/adapters/whatsmeow/registry.go`: multi-device registry keyed by
  `phone_number_id` (implements `ports.OutboundSenderProvider`).
- `internal/service/message.go`: WABA payload mapping, logging, and forwarding
  via the webhook-config provider.
- `internal/service/executor.go`: outbound job executor (`ports.JobHandler`).
- `internal/adapters/webhook/client.go`: HTTP, HMAC, timeout, and response handling.
- `internal/adapters/queue/`: pgx `JobStore` (SKIP LOCKED) + poll consumer.
- `internal/adapters/apiconfig/client.go`: webhook-config provider (TTL cache).
- `internal/core/domain/`: internal event, payload, and job models.
- `internal/core/ports/`: service contracts (sender, job store/handler, webhook
  config provider).
- `cmd/main.go`: dependency composition and shutdown lifecycle.
- `internal/service/outbound.go`: outbound validation (reused by the executor).
- `cmd/migrate/main.go`: golang-migrate migration runner (`SUPABASE_DSN`).
- `../../shared/db/migrations/`: Supabase schema migrations (golang-migrate).

## Unused Code Cleanup

Completed cleanup based on `../../.opencode/plans/remove-unused.md`:

- Removed `internal/core/ports/whatsapp_client.go`; the interface had no
  consumers and the application uses the concrete WhatsMeow adapter directly.
- Removed the unused `Config.LogLevel` field and `LOG_LEVEL` lookup.
- Removed the ignored local `whatsmeow.db` runtime artifact. A fresh start may
  require WhatsApp login again because the local session database is gone.
- Kept plans, mapping documentation, tests, and optional outbound WABA fields;
  they are still referenced or represent supported API shape.

Cleanup verification:

```text
go test ./...        32 passed
go test -race ./... 32 passed
go vet ./...        passed
git diff --check    passed
```

## Next Agent Guidance

- Read `AGENTS.md` before changing architecture.
- Keep the current separation between raw event translation and WABA payload
  construction.
- Update tests and `../../.opencode/plans/waba-webhook-mapping.md` for every new
  mapping or runtime behavior change.
- Run `gofmt`, `go test ./...`, and `go vet ./...` before handoff.
- Do not commit `whatsmeow.db`, credentials, or `.opencode` index artifacts.

## Latest Verification

```text
go test ./...        32 passed
go test -race ./... 32 passed
go vet ./...        passed
git diff --check    passed
```

A manual Direct Send smoke test was completed successfully for recipient
`6285293322073` using the text request documented in `../../README.md`.

## Direct Send (Removed in M5)

The legacy Echo v4 HTTP adapter (`internal/adapters/httpapi/`) was removed in
M5; the HTTP surface now lives in `services/api`. Worker outbound handling is
queue-driven: the API enqueues a `send_message` job and the worker consumes it
via `internal/adapters/queue` → `internal/service/executor.go` → the per-device
WhatsMeow sender. Validation lives in `internal/service/outbound.go`
(`validateOutboundMessage`, reused by the executor).
