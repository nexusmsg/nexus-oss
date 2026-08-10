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

- `POST /:phone_number_id/messages` — bearer auth (`API_AUTH_TOKEN`), WABA validation (mirrors `internal/service/validate.go`), optional idempotency key (header wins over body), enqueues a `send_message` job, polls the job row until `SEND_TIMEOUT_MS` (default 25000) every `RESULT_POLL_MS` (default 250), returns the official WABA 200 envelope with the real `wamid` from `result.wa_message_id`, or a WABA error envelope (504 on timeout).
- `GET /internal/webhook-config?phone_number_id=...` — bearer auth (`INTERNAL_TOKEN`), returns `{ webhook_url, webhook_secret }` (secret null-able); 404 when absent.

Env: `PORT`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `API_AUTH_TOKEN`, `INTERNAL_TOKEN`, `SEND_TIMEOUT_MS`, `RESULT_POLL_MS`.

**M5 contract:** the queue consumer must complete succeeded jobs with `result: { "wa_message_id": "<real wamid>" }` (the API reads this exact key). Source: `services/api/src/{app,transport,config}.ts`.

## Runtime Flow

Paths below are relative to `services/worker/`.

```text
WhatsMeow event
  -> internal/handlers/whatsapp/handler.go (per-device, constructed in cmd/whatsapp_worker)
  -> entity.InboundEvent
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
  -> internal/handlers/channel consumer (Claim, FOR UPDATE SKIP LOCKED)
  -> internal/service/whatsapp_executor.go: lazy ensureDevice (GetByPhoneNumberID ->
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
go run ./cmd/whatsapp_worker
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
  table; `cmd/whatsapp_worker/main.go` boot-syncs stored sessions into
  `DeviceManager` via `ListSessions` → `EnsureDevice` → `ConnectStored`.

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
- `internal/handlers/whatsapp/handler.go`: raw WhatsMeow event translation
  (anti-corruption layer; constructed in `cmd/whatsapp_worker` and injected
  into `DeviceManager` via `EventHandlerFactory`).
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
- `internal/service/whatsapp_executor.go`: outbound job executor
  (`ports.JobHandler`) with lazy device ensure via
  `SessionStore.GetByPhoneNumberID` and `jobs` write-back via
  `source_job_serial`.
- `internal/adapters/webhook/client.go`: HTTP, HMAC, timeout, and response handling.
- `internal/adapters/queue/`: pgx `JobStore` (SKIP LOCKED) + `SessionStore`
  (ListSessions/GetByPhoneNumberID/UpdateHeartbeats) + batched `Heartbeat`.
- `internal/handlers/channel/`: `NewConsumer` poll loop + `processJob` (the
  queue consumer; moved here from the deleted `internal/adapters/queue`
  consumer).
- `internal/adapters/apiconfig/client.go`: webhook-config provider (TTL cache).
- `internal/core/entity/`: internal event, payload, job, and session models.
- `internal/core/ports/`: service contracts (sender, device manager, job
  store/handler, session store, webhook config provider).
- `cmd/worker/main.go` / `cmd/whatsapp_worker/main.go`: two composition roots
  (stateless dispatcher / stateful WhatsApp executor).
- `internal/service/validate.go`: outbound validation (reused by the executor).
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
via `internal/handlers/channel` (NewConsumer) → `internal/service/whatsapp_executor.go`
→ the per-device WhatsMeow sender. Validation lives in
`internal/service/validate.go` (`validateOutboundMessage`, reused by the
executor).

## Nexus Dashboard — Deprecation Notice (2026-08-10)

> **DEPRECATION NOTICE — the dashboard records below are historical.** The
> original Vite dashboard (React + Vite + TS) described in "Nexus Dashboard
> (M1)" was **deleted on 2026-08-10**; the dashboard is being rebuilt from the
> ground up as a Next.js 16 app on top of the newly built design system. The
> "Components Missing" investigation and "Button icon+label inline fix"
> sections below are likewise superseded historical records — their fixes
> already landed in the current design system. The current sessions milestone is
> tracked in `.opencode/plans/sessions-page.md`. Worker sections at the
> top of this file remain current; the dashboard sections below are frozen
> history.

## Nexus Dashboard — Current State (2026-08-10)

Rebuilt from the ground up after the Vite implementation was deleted:

- **Stack**: Next.js 16.3 (App Router, Turbopack) + Tailwind CSS v4 + React 19,
  dev on port **3002** (`apps/dashboard/package.json`; 3000 = API, 3001 = PostgREST).
- **Design system (done, verified)**: tokens via `@theme` in
  `src/app/globals.css` (all core tokens match the design `:root` block), 19
  components + icons in `src/components/`, verified playground at `/` (no
  horizontal overflow at 360/480/768/1440/1920). Button icon+label inline fix
  already applied.
- **Screens phase (next)**: routes, API client + auth gate, then screens. The
  current sessions milestone is tracked in
  `.opencode/plans/sessions-page.md`.
- **Not committed yet**: the whole `apps/dashboard/` tree is untracked.

## Nexus Dashboard (M1, 2026-08-05) — HISTORICAL (deleted implementation)

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
  notes. The old dashboard plan is historical and has been removed.
- Stale API docs fixed (commit `82d608b`): `docs/services/api/endpoints.md` +
  `docs/services/api/architecture.md` now document Bearer-or-Basic auth with
  `WWW-Authenticate: Basic realm="nexus"`, the `/api/v1/*` CORS section, and
  that retry/timeout/enabled fields are PATCH-only on webhooks.
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

## Worker Split — M13 + M14 (2026-08-06)

The worker is now split into two binaries communicating through the
`whatsmeow_jobs` table. `services/api/` is untouched; it still polls `jobs`
for terminal status + `result.wa_message_id`.

### M13 — `whatsmeow_jobs` migration + parameterized `Store`

- `shared/db/migrations/000007_create_whatsmeow_jobs.up/.down.sql`: clone of
  000001 (`jobs`) with renamed table/trigger/indexes, plus `source_job_serial
  uuid` (after `serial`, no FK) and `whatsmeow_jobs_source_idx`. Same status
  vocabulary `pending/claimed/succeeded/failed`. `set_updated_at()` is not
  re-created (owned by 000001). Down drops trigger then table (not the fn).
- `internal/adapters/queue/store.go`: `Store` gained a `table` field (trusted
  constructor constant, never env) + `ownsPool`; `NewStore(ctx, dsn, table,
  logger)` creates the pool, `NewStoreWithPool(pool, table, logger)` wraps a
  shared pool; `Close()` only closes an owned pool. All SQL interpolates
  `s.table`.
- Updated callers: `test/integration/store_integration_test.go` (`"jobs"`),
  `cmd/worker/main.go` (`"jobs"`).
- Docker migrate step was skipped (daemon down at the time).

### M14 — dispatcher + executor + two entrypoints

- `internal/core/entity/job.go`: added `SourceJobSerial string` (uuid,
  `""` = none). **Deviation:** spec said `int64`, but `source_job_serial` is a
  uuid column and `Complete(serial string)` + `job.Serial` are strings — int64
  cannot hold a uuid and would not compile.
- `internal/core/ports/errors.go`: `ports.ErrDispatched` sentinel.
- `internal/core/ports/job_store.go`: `Enqueue(ctx, job) (string, error)` —
  **deviation:** spec said `(int64, error)`, but `RETURNING serial` returns a
  uuid, so the return type is `string`.
- `internal/adapters/queue/store.go`: `Enqueue` inserts
  `(type, phone_number_id, payload, idempotency_key, status, attempts,
  max_attempts, source_job_serial)` — **deviation:** spec's proposed column
  list omitted `type`/`phone_number_id` (both NOT NULL; `phone_number_id` has
  no default, so that INSERT would fail). Claim SELECT/scan now conditionally
  include `source_job_serial` for the `whatsmeow_jobs` table.
- `internal/handlers/channel/handler.go`: `NewConsumer` poll loop —
  `errors.Is(err, ports.ErrDispatched)` → log + `return nil` (row stays
  `claimed`). Claim semantics are covered by the integration suite in
  `test/integration/` (`TestSplitClaimSemanticsRealDB`).
- `internal/service/dispatcher.go` (new): validates send payloads
  (`validateOutboundMessage`), sets `SourceJobSerial = Serial`, Enqueues,
  returns `ports.ErrDispatched`. **Deviation:** spec said `*slog.Logger`; the
  rest of the worker uses stdlib `*log.Logger`, so it matches the codebase.
- `internal/service/whatsapp_executor.go` (new): ported JobExecutor logic
  (ensureDevice/handlePairing/handleLogout/handleSendMessage) + `jobsStore`
  write-back. On success → `jobsStore.Complete(sourceJobSerial, result)`
  (write-back errors logged, NOT propagated — avoids retrying a send that
  already succeeded into a duplicate message). On terminal failure
  (`isTerminalAttempt`: `MaxAttempts > 0 && Attempts >= MaxAttempts`, mirroring
  the consumer's `Attempts >= effectiveMax` where `effectiveMax = MaxAttempts`
  when the row sets it — whatsmeow_jobs always does, default 3) →
  `jobsStore.Fail(sourceJobSerial, err)`; retryable attempts leave `jobs`
  `claimed`.
- `cmd/worker/main.go` (new): stateless. One pool → `NewStore("jobs")` +
  `NewStoreWithPool("whatsmeow_jobs")`, `Consumer(jobsStore,
  Dispatcher(dispatchStore))`. No WhatsMeow imports.
- `cmd/whatsapp_worker/main.go` (new): current `cmd/main.go` wiring
  (boot sync, heartbeat, shutdown) but the consumer polls `whatsmeow_jobs` and
  a second `NewStoreWithPool("jobs")` backs the executor's write-back.
- **Kept on purpose:** `cmd/main.go` and `internal/service/executor.go` — the
  spec's step 6/8 conflict (delete executor.go vs. keep cmd/main.go compiling
  and working) resolves to keeping both until the split e2e passes.
- Infra: `package.json` build → three binaries (worker/whatsapp_worker/migrate),
  `dev` → whatsapp_worker, new `dev:worker`; `Dockerfile` builds all three into
  `/app` (ENTRYPOINT stays `/app/worker`); `docker-compose.yml` splits `worker`
  into `worker` (dispatcher) + `whatsapp_worker` (entrypoint override →
  `/app/whatsapp_worker`) sharing one image + env anchor.
- Docs: `services/worker/AGENTS.md` (two-binary split, sentinel + write-back
  contracts), `docs/services/worker/{README,architecture,queue,configuration}.md`,
  `docs/services/README.md`, `docs/README.md` updated to the two-binary flow.

### Verification (M14)

```text
gofmt -l .                                clean (no output)
go test ./...                             102 passed (14 packages)
go vet ./...                              clean
CGO_ENABLED=0 go build ./cmd/...          OK (cmd, cmd/worker, cmd/whatsapp_worker, cmd/migrate)
docker compose build migrate              NOT run — Docker daemon down
```

### Worker Hexagonal Cleanup + Test Pyramid — M15 (2026-08-07)

M14's legacy artifacts are deleted and the worker test pyramid is complete:
unit → functional → real-DB integration, all green.

- **Hexagonal closure (Lane A):** `ports.WebhookForwarder.Forward(ctx, cfg
  entity.WebhookConfig, payload entity.WebhookPayload) error`; the webhook
  adapter is config-agnostic (`NewClient()`, no env reads); `NewMessage(logger,
  provider, forwarder)`; both `cmd/worker` and `cmd/whatsapp_worker` wire
  `webhook.NewClient()`. The service layer no longer imports any adapter
  (grep-verified). Retry policy (3 attempts, 200/400/800ms) preserved.
- **Legacy removal (Lane C):** deleted `cmd/main.go` and
  `internal/service/executor.go` and its unit test;
  `.vscode/launch.json` repointed at `cmd/whatsapp_worker`; docs swept
  (`services/worker/AGENTS.md`, `docs/services/worker/{README,configuration}.md`).
  The old `JobExecutor`/`NewJobExecutor` dead code is gone.
- **Unit/functional tests (Lanes B + D):** 13 JobExecutor tests re-homed onto
  `WhatsAppExecutor`, 6 write-back tests, 6 Dispatcher tests, 3 functional
  split-flow tests (`split_flow_test.go`, package `service_test`, mutex-guarded
  in-memory `fakeJobStore`, race-clean over 15+ runs); test doubles
  consolidated in `fakes_test.go`; `vcard_test.go`,
  `core/entity/outbound_test.go` added.
- **Integration tests (Lane E):** `test/integration/split_integration_test.go`
  — dispatch + write-back flows against a real Postgres
  (`TEST_DATABASE_URL`-gated, mirrors the existing store/session integration
  conventions). Confirms claim increments `attempts` and the `jobs` (no
  `source_job_serial`) vs `whatsmeow_jobs` (has it) split.
- **Production fixes surfaced by the tests:**
  - `vcard.go`: `card.SetValue(vcard.FieldVersion, "3.0")` — the encoder
    hard-errors when VERSION is missing.
  - `dispatcher.go`: nil-guard ("dispatcher: dispatch store is nil").
  - `store.go`: `Enqueue` is now table-aware like `Claim` —
    `enqueueSourceFragments()` appends the `source_job_serial` column +
    placeholder only for `whatsmeow_jobs`. Latent bug: the hardcoded 8-column
    INSERT always referenced `source_job_serial`, which the `jobs` table lacks
    (exposed by the real-DB integration run; never reached in prod because the
    API inserts `jobs` rows via PostgREST).
- **Docs:** `docs/services/worker/README.md` + `configuration.md` updated for
  the two-binary layout; `AGENTS.md` layout section updated.

### Verification (M15)

```text
gofmt -l .                               clean (no output)
go vet ./...                             clean
go test ./... -count=1                   127 passed (13 packages)
CGO_ENABLED=0 go build ./cmd/...         OK (worker, whatsapp_worker, migrate)
go test -race ./internal/service \
  ./internal/adapters/queue              68 passed (2 packages)

Real-DB integration (throwaway waba-it-postgres on :5433, torn down after):
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/waba?sslmode=disable \
  go test ./internal/adapters/queue -count=1 -v
  → 24 passed / 24 — TestSplitDispatchContract, TestSplitWriteBackContract
    (success + terminal failure), TestSplitClaimSemantics, TestStoreIntegration,
    TestSessionStoreIntegration (no skips, no failures)
```

### Pending

- e2e against the compose stack with a **live WhatsApp account** (requires
  Docker + real pairing): confirms the full API → jobs → worker →
  whatsmeow_jobs → whatsapp_worker → WhatsMeow → jobs write-back chain end to
  end. The split itself is already covered by functional tests
  (`split_flow_test.go`) and the real-Postgres integration suite
  (`split_integration_test.go`); only the live-WhatsApp leg remains unverified
  because it needs an actual device to pair.
- Commit the M15 work (per repo milestone rules, reference M15 in the commit
  message). M13 (`52220d1`) and M14 (`b6c8006`) are already committed.

## M16 — Skill-Compliance Restructure (2026-08-07)

M16 restructured `services/worker` to the test pyramid and layering defined by
the user's skills (`unit-test` / `functional-test` / `integration-test` /
`hexagonal-architecture`):

- **Test pyramid (per the skills):**
  - *Unit* tests target pure functions only: `internal/core/entity/*_test.go`,
    `internal/adapters/*/dto/mapper_test.go`,
    `internal/handlers/whatsapp/dto/mapper_test.go`,
    `internal/service/validate_test.go`.
  - *Functional* tests cover `internal/service/*_test.go` with mocked ports,
    a hermetic sleeper injection, and no adapter imports.
  - *Integration* suites moved to `test/integration/` behind
    `//go:build integration`: WireMock suites (webhook forward + apiconfig;
    golden files under `testdata/golden/`, `-update` flag regenerates them)
    and real-Postgres `-run RealDB` suites (gated on `TEST_DATABASE_URL`).
- **New layers:** `internal/handlers/channel/` (queue consumer:
  `NewConsumer` / `Run` / `processJob`) and `internal/handlers/whatsapp/`
  (inbound event handler). The whatsapp handler is constructed in
  `cmd/whatsapp_worker/main.go` and injected into `DeviceManager` via
  `EventHandlerFactory` — M16 finding-1 fix.
- **Deleted:** the whatsmeow event-translation handler, the queue consumer
  (with its unit test), `session_store_test.go`, and the old adapter-level
  unit/integration tests.
- **Renames:** the `domain` package was renamed `entity` — the inbound-event
  model is now `entity.InboundEvent`. `DefaultMaxAttempts` lives in
  `internal/core/entity/outcome.go`; `webhookForwardAttempts` = 4 in
  `internal/service/message.go` (adjudicated correct).
- **Verification:** `go test ./...` = 168 passed / 18 packages / 0 FAIL;
  `go test -race` = 61 PASS; WireMock = 5 PASS; RealDB = 16 PASS; oracle
  Gate 2 review = PASS.

## Nexus Dashboard — "Components Missing" Investigation (2026-08-10)

Context: user manually verified the dashboard, reported 4 issues (sidebar/topbar
layout, button-icon inline, toggle shape, unicode rendering), then reported
"many components don't appear" and asked to check the designer task. The
revision dispatch to @designer was **cancelled by the user** — no code changed
for those 4 issues.

### Root cause of "components don't appear" — WRONG PORT

- Dashboard dev server runs on **port 3002** (`apps/dashboard/package.json`:
  `dev: "next dev -p 3002"`).
- **Port 3001 is owned by OrbStack (docker)** and serves PostgREST (the API's
  swagger/OpenAPI JSON), not the dashboard. Opening `http://localhost:3001/`
  shows PostgREST JSON — that is why the user saw "no components".
- **Dashboard URL: `http://localhost:3002/`** — everything renders.
- `AGENTS.md` (apps section) still says `next dev -p 3001` — **stale**; 3001 is
  the PostgREST host port per root `HANDOFF.md` / `docker-compose.yml`. Docs
  should be updated to 3002.

### Verification evidence (agent-browser, live on :3002)

All components render (full body-text extraction): Sidebar, Topbar, Buttons,
Badges/StatusDots, StatCards, DeviceStatus, QuickActions, Alerts, Form
Controls, Toggles, API Key Management, Activity Log table, EmptyStates,
Avatars, Tooltips. No console/`__NEXT_DATA__` errors.

Computed-style/geometry checks (window 577px tall):

- Sidebar: `position: fixed`, top 0 → bottom 577 (= full viewport), width 240.
  Topbar: `sticky`, left 240, gap sidebar→topbar = **0** → the "sidebar
  terpisah / tidak sampai bawah" issue is **not present** in current code.
- Toggles (3 found): 40×22, `border-radius: 11px` — exactly the
  `design/dashboard/settings.html` geometry (`.toggle-slider` radius 11px) →
  the "oval bukan pil" issue is **not present**; current shape matches the
  design contract.
- Icon buttons: `display: flex`, `align-items: center`, `gap: 6px`, SVG
  vertically centered → "icon tidak inline" **not present**.
- Unicode: `—` (webhook table, `POST /hooks/inbound — timeout`) and `•` masks
  (`nx_live_••••…`) render as real glyphs in the browser. Note: the earlier
  hypothesis that `\u2014` in JSX text renders literally was **wrong** — JSX
  text children DO decode `\uXXXX`; the cancelled revision task would have been
  unnecessary churn.

Conclusion: current implementation matches the design contract on all 4
reported dimensions; the user-visible breakage was the port. If the user still
wants changes (e.g. a different toggle radius, or a truly "rectangular pill"),
those are design-opinion changes, not bug fixes.

### Environment state at handoff

- Dashboard dev server running on 3002 (PID 31301, `next dev -p 3002`); leave
  it or restart via `npm run dev` in `apps/dashboard/`.
- Port 3000 = API, 3001 = PostgREST (both OrbStack/docker).
- agent-browser session left open on `http://localhost:3002/` (close with
  `agent-browser close` when done).
- Reusable specialist sessions (background job board): `des-1`
  (ses_0187fdd59ffeKU3peG2HnvbH57, designer, full dashboard context),
  `exp-1`, `ora-1`, `fix-1`, `lib-1`.

### Next steps

1. Update `apps/AGENTS.md` (and any docs) to port **3002** — or free 3001 from
   PostgREST and switch back, then document the choice.
2. Optional: reconcile the earlier 4 reported issues with the user — evidence
   says they are already correct against the design HTML exports.
3. Re-run the cancelled revision ONLY if the user asks for design-opinion
   changes beyond the design contract.

## Dashboard — Button icon+label inline fix (2026-08-10)

User reported buttons with icons stacking **atas-bawah** (icon above label)
instead of inline. Reproduced on the playground "With Icons" section in
`apps/dashboard/src/app/page.tsx` (e.g. Generate Key, Test Endpoint, Add
Device).

### Root cause

Not a page-level layout issue. `apps/dashboard/src/components/Button.tsx`
wraps `children` in a loading-state `<span>`:

```tsx
<span className={cx(loading && "invisible")}>{children}</span>
```

- The outer `<button>` already has `inline-flex items-center gap-1.5`, but
  flex only applies to **direct** children (spinner + wrapper span).
- Inside the wrapper, icon SVG + text are normal flow.
- Tailwind Preflight sets `svg { display: block }`, so SVG + adjacent text
  stack vertically.

Earlier investigation (section above) checked **icon-only** buttons
(`variant="icon"`) and correctly saw flex centering — that path has a single
SVG child, so the bug never showed. The "With Icons" path (icon **and**
label text inside one Button) was the real case.

### Fix

Make the content wrapper flex as well:

```tsx
<span
  className={cx(
    "inline-flex items-center justify-center gap-1.5",
    loading && "invisible",
  )}
>
  {children}
</span>
```

File: `apps/dashboard/src/components/Button.tsx`. All icon+label usages
(playground, EmptyState CTAs, etc.) pick this up automatically — no
`page.tsx` changes needed.

### Note for next agent

If similar "icon + text stacked" reports land on other components, check for
a non-flex wrapper around mixed SVG/text children under Tailwind Preflight
before redesigning page layout.

