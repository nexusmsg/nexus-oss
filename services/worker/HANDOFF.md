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


The project receives WhatsMeow message events, maps supported event types into
WhatsApp Business API-shaped webhook payloads, logs the final JSON payload, and
forwards it to a configured HTTP endpoint.

Latest relevant commit:

```text
d5cbc2e feat: add Direct Send HTTP API
```

Verification at previous handoff:

```text
go test ./...   25 passed
go vet ./...   passed
```

## Runtime Flow

```text
WhatsMeow event
  -> internal/adapters/whatsmeow/handler.go
  -> domain.InboundEvent
  -> internal/service/message.go
  -> WABA payload construction
  -> payload log
  -> ports.WebhookForwarder
  -> internal/adapters/webhook/client.go
  -> configured HTTP endpoint

HTTP Direct Send request
  -> internal/adapters/httpapi/server.go
  -> internal/service/outbound.go
  -> ports.MessageSender
  -> bounded outbound channel
  -> existing WhatsMeow client
  -> WABA-shaped HTTP response
```

## Implemented Behavior

- WhatsMeow's default stdout logger is disabled with `waLog.Noop`.
- Incoming message events are logged with message ID, sender, raw type, and
  `from_me` status.
- Supported mappings currently include conversation text, extended text,
  location, reaction, button reply, list reply, and message context.
- Self-sent messages (`IsFromMe`) are ignored.
- WABA payload metadata comes from `BUSINESS_ACCOUNT_ID`, `PHONE_NUMBER_ID`,
  and `DISPLAY_PHONE_NUMBER`.
- The service logs the final JSON payload before forwarding it.
- Forwarding uses HTTP POST with `Content-Type: application/json`.
- Optional `WEBHOOK_SECRET` produces `X-Hub-Signature-256` using HMAC-SHA256
  over the exact JSON request body.
- Non-2xx responses are returned as errors.
- Requests use a 15-second HTTP client timeout and propagate the inbound
  context.
- Empty `WEBHOOK_URL` disables forwarding while payload logging continues.
- Shutdown uses `signal.NotifyContext` so active operations can be canceled.
- Echo v4 serves `POST /<PHONE_NUMBER_ID>/messages` on `PORT` (default `8080`).
- Text Direct Send requests are validated and dispatched through one long-lived
  WhatsMeow connection.
- The outbound queue is bounded to 32 commands and uses one worker.
- `API_AUTH_TOKEN` optionally enables bearer-token validation for Direct Send.
- Direct Send errors use a WABA-shaped `error` envelope.

## Configuration

Set these environment variables before running:

```bash
BUSINESS_ACCOUNT_ID="your-business-account-id"
PHONE_NUMBER_ID="your-phone-number-id"
DISPLAY_PHONE_NUMBER="+628123456789"
WEBHOOK_URL="http://localhost:8080/webhook"
WEBHOOK_SECRET="optional-secret"
API_AUTH_TOKEN="optional-token"
PORT="8080"
SUPABASE_DSN="postgresql://user:pass@host:5432/db"
MIGRATIONS_DIR="../../shared/db/migrations"
```

Run the application with:

```bash
go run ./cmd
```

`PORT` is used by the local Direct Send HTTP server. If `WEBHOOK_URL` is also
configured, use a separate port for the receiving webhook application; the
local Direct Send server does not expose `/webhook`.

## Important Decisions

- WhatsMeow-specific types stay inside the WhatsMeow adapter.
- WABA payload construction stays in the service layer.
- `WebhookForwarder` is a port and the HTTP client is its adapter.
- `MessageSender` is a port and the WhatsMeow adapter implements it with a
  channel-backed single-client worker.
- Domain types do not import WhatsMeow or HTTP packages.
- Payload fields that cannot be reconstructed are omitted rather than
  invented.
- `entry[].id` comes from `BUSINESS_ACCOUNT_ID`; it cannot be derived from a
  normal WhatsApp sender number.

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
- `internal/adapters/whatsmeow/client.go`: WhatsMeow lifecycle and quiet logger.
- `internal/service/message.go`: WABA payload mapping, logging, and forwarding.
- `internal/adapters/webhook/client.go`: HTTP, HMAC, timeout, and response handling.
- `internal/core/domain/`: internal event and payload models.
- `internal/core/ports/`: service contracts.
- `cmd/main.go`: dependency composition and shutdown lifecycle.
- `internal/adapters/httpapi/server.go`: Echo v4 Direct Send server.
- `internal/service/outbound.go`: Direct Send validation and response mapping.
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

## Direct Send API Status

The application now also exposes a local Echo v4 HTTP server that mirrors the
WABA Direct Send route:

```text
POST /<PHONE_NUMBER_ID>/messages
```

The request body follows the WABA JSON shape. The current supported outbound
message is a text message with `messaging_product` set to `whatsapp`, a `to`
phone number, `type` set to `text`, a non-empty `text.body`, and an optional
`category` of `utility`, `authentication`, or `service`.

The HTTP request is passed to an outbound service, then to a bounded channel
owned by `internal/adapters/whatsmeow/client.go`. A single worker calls the
already-connected `whatsmeow.Client.SendMessage`; no new WhatsMeow connection
is created per request. Request cancellation is checked before dispatch and
while waiting for a response. Shutdown stops HTTP intake before the WhatsMeow
client is disconnected.

`API_AUTH_TOKEN` enables optional `Authorization: Bearer ...` validation. The
server uses `PORT` (default `8080`). Invalid requests use a WABA-shaped error
envelope. Queue capacity is currently fixed at 32 commands.

## Direct Send Deferred Work

- Full authentication-category message payloads and access restrictions.
- Template, CTA URL, reply, and mixed-button message mappings.
- TTL validation and delivery semantics.
- Media, contacts, poll, and native-flow outbound mappings.
- Configurable queue capacity and explicit queue-full response behavior.
- Production-grade authentication/token rotation.

## Direct Send Relevant Files

- `../../.opencode/plans/waba-direct-send.md`: implementation plan and boundary.
- `internal/core/domain/outbound.go`: outbound WABA request/response models.
- `internal/core/ports/message_sender.go`: outbound contracts.
- `internal/service/outbound.go`: validation and response mapping.
- `internal/adapters/httpapi/server.go`: Echo v4 HTTP API.
- `internal/adapters/whatsmeow/client.go`: channel-backed single-client dispatch.
- `cmd/main.go`: HTTP/WhatsMeow composition and shutdown ordering.
