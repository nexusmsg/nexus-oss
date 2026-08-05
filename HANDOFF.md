# Handoff Notes

## Monorepo Restructure (M1)

The project is now a Turborepo monorepo:

- `apps/` — UI placeholder (`.gitkeep` only).
- `services/api/` — Node.js Hono API scaffold; enqueue + synchronous result
  wait and internal webhook-config API land in later milestones.
- `services/worker/` — this Go worker.
- `shared/db/migrations/` — golang-migrate SQL migrations (M2).
- Root `package.json` + `turbo.json` orchestrate every package.

Root commands: `npm install`, then `npm run dev` / `npm run build` /
`npm run test` (Turborepo). This document lives at the repo root, so relative
references like `.opencode/plans/` and `README.md` resolve from there. Paths
that are relative to the worker (for example `internal/...` or `cmd/...`) are
noted as such.

## Migrations (M2)

- Schema migrations live in `shared/db/migrations/` (golang-migrate
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
- Up: `docker compose up --build -d`. Verify: `curl localhost:3000/` returns `{"ok":true,"service":"api"}`, postgrest on 3001, `schema_migrations` version 5 (000001–000005 applied).
- **Migrations are baked into the worker/migrate image at build time** — after adding a migration file, `docker compose build migrate` is required before `up -d`; plain `up -d` reuses the old image and silently skips the new migration.

## Current Status

The worker now runs the M9 architecture:

- **DeviceManager actor model** (`internal/adapters/whatsmeow/manager.go` +
  `actor.go`): one manager goroutine routes lifecycle commands
  (EnsureDevice/Pair/Logout/ConnectStored) to per-device actor goroutines.
  Devices are provisioned from the `sessions` table, replacing the old static
  `WABA_DEVICES` registry (removed).
- **Boot sync**: `ListSessions` → `EnsureDevice` per stored session →
  `ConnectStored` (connects only sessions with a stored WhatsMeow session, no
  QR at boot). Sessions created later are lazy-ensured by the executor.
- **Lazy ensure** (`executor.go`): before pairing/logout/send, resolve the
  session via `GetByPhoneNumberID` (missing → job fails "session not found")
  and call `EnsureDevice`. `ErrAlreadyPaired` is treated as idempotent success
  (no QR, status stays `created`).
- **Queue consumer** (pgx): polls `jobs`, claims with `FOR UPDATE SKIP LOCKED`,
  completes with `result: {"wa_message_id": "<real wamid>"}`, retries with
  exponential backoff, fails after max attempts.
- **Outbound executor** (service layer): claimed job → lazy ensure → validate →
  `ports.MessageSender` (from `DeviceManager.Sender`) → real wamid.
- **Heartbeat** (`internal/adapters/queue/heartbeat.go`): batch-refreshes
  `sessions.last_seen_at` via `UpdateHeartbeats(ActiveDevices())`; skips the
  DB round-trip when no devices are active.
- **Webhook config provider** (`apiconfig`): before forwarding an inbound
  event, fetches `GET {API_URL}/internal/webhook-config?phone_number_id=...`
  (Bearer `INTERNAL_TOKEN`, per-ID TTL cache); payloads are forwarded with the
  returned secret (HMAC) and a bounded non-2xx retry.
- `business_account_id` is now per-session (migration 000005): the API accepts
  it on create and echoes it; the worker uses it as `entry[].id`, falling back
  to the global `BUSINESS_ACCOUNT_ID` when empty.
- The legacy Echo HTTP adapter (`internal/adapters/httpapi/`) was **removed**
  along with `PORT`/`API_AUTH_TOKEN` worker config — the API owns the HTTP
  surface now.

Latest commit: M9 (see `git log --oneline -5`). Verification log in
`.opencode/plans/split-architecture.md`.

M6 integration, verified against the compose stack: the full
API → PostgREST → jobs → worker → response chain runs end to end. Dev
PostgREST keys are HS256 JWTs (`{"role":"postgres"}` signed with
`PGRST_JWT_SECRET`), and the API talks to bare PostgREST via
`@supabase/postgrest-js` (supabase-js appends `/rest/v1`, which only exists
behind Supabase's Kong). Outbound failures surface through the API as WABA
error envelopes carrying the worker's `last_error`.

Verification at this handoff:

```text
go test ./...   58 passed (10 packages)
go vet ./...   passed
CGO_ENABLED=0 go build ./...   passed
api: tsc clean, 51 tests passed
```

## API Surface (M4, for M5 worker wiring)

`services/api` now exposes the two endpoints the worker consumes/produces:

- `POST /:phone_number_id/messages` — bearer auth (`API_AUTH_TOKEN`), WABA validation (mirrors `service/outbound.go`), optional idempotency key (header wins over body), enqueues a `send_message` job, polls the job row until `SEND_TIMEOUT_MS` (default 25000) every `RESULT_POLL_MS` (default 250), returns the official WABA 200 envelope with the real `wamid` from `result.wa_message_id`, or a WABA error envelope (504 on timeout).
- `GET /internal/webhook-config?phone_number_id=...` — bearer auth (`INTERNAL_TOKEN`), returns `{ webhook_url, webhook_secret }` (secret null-able); 404 when absent.

Env: `PORT`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `API_AUTH_TOKEN`, `INTERNAL_TOKEN`, `SEND_TIMEOUT_MS`, `RESULT_POLL_MS`.

**M5 contract:** the queue consumer must complete succeeded jobs with `result: { "wa_message_id": "<real wamid>" }` (the API reads this exact key). Source: `services/api/src/{app,transport,config}.ts`.

## Runtime Flow

Paths below are relative to `services/worker/`.

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
  -> internal/service/executor.go: lazy ensureDevice (GetByPhoneNumberID ->
     DeviceManager.EnsureDevice; missing session fails the job) -> unmarshal
     payload -> validate
  -> whatsmeow.DeviceManager.Sender(phone_number_id) -> per-device bounded
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
- WABA payload metadata comes from `BUSINESS_ACCOUNT_ID` (global fallback) and
  per-device `phone_number_id` + display number provisioned from the `sessions`
  table. `entry[].id` uses the session's `business_account_id`, falling back to
  the global `BUSINESS_ACCOUNT_ID` when empty.
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
- Multi-device: one `whatsmeow.Client` per `phone_number_id`, driven by
  `DeviceManager` (one manager goroutine + one actor goroutine per device),
  each with its own bounded outbound queue (32) and worker goroutine; QR
  login and reconnect (bounded backoff) are handled per device.
- Pairing is lazy: the executor ensures the device before pairing/logout/send;
  `ErrAlreadyPaired` is treated as idempotent success (no QR).
- Heartbeat refresh is batched: `UpdateHeartbeats(ActiveDevices())` and skips
  the DB when no devices are active.
- Outbound jobs are claimed from Postgres with `FOR UPDATE SKIP LOCKED`,
  executed through the per-device queue, completed with the real wamid in
  `result.wa_message_id`, retried with exponential backoff, and failed after
  `max_attempts`.

## Configuration

Set these environment variables before running:

```bash
BUSINESS_ACCOUNT_ID="your-business-account-id"
# Devices are provisioned from the sessions table (no static list).
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

Devices are provisioned from the `sessions` table: each stored session is
boot-synced into a device and QR pairing re-provisions on demand. The display
phone defaults to the session's number. The
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
  channel-backed per-device worker; `DeviceManager` resolves senders by
  `phone_number_id` and implements `OutboundSenderProvider` + `ActiveDeviceProvider`.
- `DeviceManager` (port) uses an actor model: a single manager goroutine routes
  lifecycle commands to one goroutine per device; callers wait on a response
  channel, never inside the manager loop. `EnsureDevice` auto-connects devices
  that already have a stored WhatsMeow session; `ErrAlreadyPaired` marks a
  device that is already paired so pairing can be treated as idempotent.
- `JobStore` (pgx, SKIP LOCKED) and `JobHandler` (service executor) keep the
  consumer loop decoupled from business logic; retry/backoff policy lives in
  the consumer.
- Domain types do not import WhatsMeow or HTTP packages.
- Payload fields that cannot be reconstructed are omitted rather than
  invented.
- `entry[].id` comes from the session's `business_account_id`, falling back to
  `BUSINESS_ACCOUNT_ID`; it cannot be derived from a normal WhatsApp sender
  number.
- `config` stays dependency-free: devices are provisioned from the `sessions`
  table; `cmd/main.go` boot-syncs stored sessions into `DeviceManager` via
  `ListSessions` → `EnsureDevice` → `ConnectStored`.

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
`services/worker/docs/api-mapping-webhook.md` and
`.opencode/plans/waba-webhook-mapping.md`.

## Relevant Files

Paths are relative to `services/worker/` unless noted.

- `AGENTS.md` (repo root): repository architecture and implementation rules.
- `docs/api-mapping-webhook.md`: source mapping specification.
- `.opencode/plans/waba-webhook-mapping.md`: milestone and verification tracker.
- `internal/adapters/whatsmeow/handler.go`: raw WhatsMeow event translation.
- `internal/adapters/whatsmeow/manager.go`: `DeviceManager` — manager
  goroutine, EnsureDevice/Pair/Logout/ConnectStored routing, ActiveDevices,
  Shutdown, Sender lookup (implements `ports.DeviceManager` +
  `ports.OutboundSenderProvider`).
- `internal/adapters/whatsmeow/actor.go`: per-device actor goroutine
  (`deviceRef`) — pairCtx/QR channel, connect/reconnect pending flags,
  cmdConnect/cmdPair/cmdLogout/cmdStop handling.
- `internal/adapters/whatsmeow/client.go`: per-device WhatsMeow lifecycle, send
  queue, QR login and reconnect handling, `hasSession()` guard.
- `internal/core/ports/device_manager.go`: `DeviceManager` + `ActiveDeviceProvider`
  + `ErrAlreadyPaired` sentinel.
- `internal/service/message.go`: WABA payload mapping, logging, and forwarding
  via the webhook-config provider.
- `internal/service/executor.go`: outbound job executor (`ports.JobHandler`)
  with lazy device ensure via `SessionStore.GetByPhoneNumberID`.
- `internal/adapters/webhook/client.go`: HTTP, HMAC, timeout, and response handling.
- `internal/adapters/queue/`: pgx `JobStore` (SKIP LOCKED) + poll consumer +
  `SessionStore` (ListSessions/GetByPhoneNumberID/UpdateHeartbeats) +
  batched `Heartbeat`.
- `internal/adapters/apiconfig/client.go`: webhook-config provider (TTL cache).
- `internal/core/domain/`: internal event, payload, job, and session models.
- `internal/core/ports/`: service contracts (sender, device manager, job
  store/handler, session store, webhook config provider).
- `cmd/main.go`: dependency composition, boot sync, and shutdown lifecycle.
- `internal/service/outbound.go`: outbound validation (reused by the executor).
- `cmd/migrate/main.go`: golang-migrate migration runner (`SUPABASE_DSN`).
- `shared/db/migrations/`: Supabase schema migrations (golang-migrate).

## Unused Code Cleanup

Completed cleanup based on `.opencode/plans/remove-unused.md`:

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

- Read `services/worker/AGENTS.md` before changing worker architecture.
- Keep the current separation between raw event translation and WABA payload
  construction.
- Update tests and `.opencode/plans/waba-webhook-mapping.md` for every new
  mapping or runtime behavior change.
- Follow the repo `AGENTS.md` workflow: define milestones before large plans
  and keep `HANDOFF.md` current as work lands.
- Run `gofmt`, `go test ./...`, and `go vet ./...` before handoff.
- Do not commit `whatsmeow.db`, credentials, or `.opencode` index artifacts.

## Latest Verification

M9, run against the compose stack:

```text
worker: gofmt clean; go vet clean; go test ./... 91 passed (10 packages)
        [integration tests run with TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/waba?sslmode=disable]
api:    tsc clean; vitest 139 passed + 25 skipped (unit); 25 passed (integration,
        run with TEST_SUPABASE_URL=http://localhost:3001 and the dev HS256 JWT)
```

## Direct Send (Removed in M5)

The legacy Echo v4 HTTP adapter (`internal/adapters/httpapi/`) was removed in
M5; the HTTP surface now lives in `services/api`. Worker outbound handling is
queue-driven: the API enqueues a `send_message` job and the worker consumes it
via `internal/adapters/queue` → `internal/service/executor.go` → the per-device
WhatsMeow sender. Validation lives in `internal/service/outbound.go`
(`validateOutboundMessage`, reused by the executor).

## Nexus Dashboard (M1, 2026-08-05)

The frontend area now has its first app — the **Nexus developer portal**:

- `apps/dashboard/` (@waba/dashboard, React + Vite + TS): shell + three routes
  (`/sessions`, `/webhooks`, `/api-keys`; `/` → redirect to `/sessions`),
  ported from `design/dashboard/` (tokens in `src/styles/tokens.css`).
- **FE auth**: env `VITE_API_TOKEN` → Bearer; otherwise a browser Basic Auth
  gate (sessionStorage cache, clear/retry on 401). Base URL via `VITE_API_URL`
  (default `http://localhost:3000`), direct cross-origin — **no Vite proxy**.
- **BE auth** (`services/api/src/adapters/http/auth.ts`): accepts Bearer **or**
  Basic against the same `API_AUTH_TOKEN` (Basic password must equal the
  token; constant-time compare); every 401 carries
  `WWW-Authenticate: Basic realm="nexus"`; empty token → auth off for both.
- **BE CORS** (`app.ts`, registered on the `apiV1` sub-router before the auth
  guard): Hono `cors` from `CORS_ORIGINS` (comma-separated; default
  `http://localhost:5173`; empty → CORS off). Methods
  GET/POST/PATCH/DELETE/OPTIONS, headers Authorization + Content-Type, no
  credentials. **Note:** CORS lives in `app.ts`, not `compose.ts` (middleware
  ordering: registering after the sub-router mount would skip non-OPTIONS
  requests); `Config` still flows from `compose.ts` → `buildApp` → `createApp`.
- New docs: `docs/apps/README.md` (app index), `docs/README.md` apps rows
  updated, `docs/services/api/configuration.md` gains `CORS_ORIGINS` + auth
  notes. Plan: `.opencode/plans/dashboard.md` (M1 marked completed).
- API-keys page is **frontend-first** (empty state; backend = B1). Webhook
  delivery log = empty state (no endpoint, B3); Test button disabled (B6);
  Verify Token omitted (B4). Session Delete/Disconnect render disabled
  (B2); Reconnect = re-run pairing.

Verification at this handoff (root turbo):

```text
npm run build  3/3 packages OK (api tsc, dashboard tsc+vite, worker go build)
npm run lint   2/2 OK (api eslint, dashboard eslint, worker gofmt)
npm test       3/3 OK — api 171 passed + 34 skipped (integration gated),
               dashboard 8 passed (client + auth-context), worker go tests
```

Integration suite (`app.integration.test.ts`) extended to cover the M1 auth +
CORS behavior against the real stack (Bearer + Basic valid/invalid +
`WWW-Authenticate`, CORS preflight allowed/disallowed/off): 34 tests, run with
`TEST_SUPABASE_URL=http://localhost:3001 TEST_SUPABASE_SERVICE_ROLE_KEY=<dev-jwt>
npx vitest run src/adapters/http/app.integration.test.ts` (dev JWT = HS256
`{"role":"postgres"}` signed with `PGRST_JWT_SECRET`, same as
`SUPABASE_SERVICE_ROLE_KEY` in `.env.example`). The manual curl smoke I ran
(sessions create→list→status→logout, webhooks create→patch→subscriptions→
delete) is now fully encoded in that suite — the "remaining M1 verification"
note below is therefore obsolete except for the browser viewport check, which
was **dropped by user decision 2026-08-05**: a Playwright E2E attempt was
started, cancelled, and fully cleaned up (no `e2e/`, no `playwright.config.ts`,
no `e2e` turbo task, no `@playwright/test` dep). FE behavior verification stays
with vitest unit tests (`src/api/client.test.ts` + `src/app/auth-context.test.tsx`,
8 tests: Bearer resolution, Basic gate flow, 401 → retry).

