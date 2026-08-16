# Handoff Notes

Current-state snapshot of the repository (2026-08-14). Historical milestones
and the verification log live in `.opencode/plans/split-architecture.md`;
product status is tracked in `ROADMAP.md`.

## Repository layout

Turborepo monorepo, three component areas:

```text
apps/dashboard/          Next.js 16 app: WABA-compatible HTTP API + management UI
services/worker/         Go + WhatsMeow message gateway (two binaries + migrate CLI)
shared/db/migrations/    SQL migrations, golang-migrate format (single source of truth)
```

One `.env` at the repo root drives dashboard, worker, and docker compose
(`dotenv-cli` for the dashboard, `godotenv` for the worker).

## Architecture

```text
┌────────────┐   HTTP (Bearer)   ┌────────────────────────────┐
│  Client /  │ ────────────────► │  apps/dashboard (Next.js)  │
│  Dashboard │                   │  /api/v1  public API        │
└────────────┘                   │  /api/internal  worker API  │
                                 └──────────┬─────────┬────────┘
                                            │         │ Drizzle/pg
                                            ▼         ▼
                                  ┌─────────────────────────┐
                                  │  Postgres (jobs,         │
                                  │  whatsmeow_jobs,         │
                                  │  sessions, webhooks,     │
                                  │  api_keys)               │
                                  └──────────┬───────────────┘
                                             │ polls / writes
                                             ▼
                            services/worker (Go + WhatsMeow)
```

The old Hono API (`services/api`) was removed on 2026-08-14; the API now lives
in the dashboard's Next.js route handlers, backed by `src/lib/api/` (hexagonal
layout: `domain/`, `ports/`, `service/`, `adapters/`).

## Dashboard API (apps/dashboard)

- **Public** `/api/v1/*` — sessions (create/pairing/QR/logout/status), webhook
  configs, API keys. Authorized by `API_AUTH_TOKEN` (bootstrap) or persisted
  `waba_*` keys, which are scoped and cannot call management routes.
- **API keys** are persisted and encrypted at rest (AES-256-GCM,
  `key_ciphertext`), with on-demand secret reveal and rename/revoke.
- **Internal** `/api/internal/v1/*` — `INTERNAL_TOKEN` only; serves the worker
  (`GET /api/internal/v1/webhook-config`, `POST /api/internal/v1/heartbeat`).
- The public send route (`POST /messages`) is not yet wired in the dashboard —
  the engine + queue + executor work (ROADMAP Phase 3).

## Worker (services/worker)

One Docker image ships three binaries; compose services select the entrypoint:

- `cmd/worker` — **stateless dispatcher**: claims `jobs`
  (`FOR UPDATE SKIP LOCKED`), validates the payload, inserts into
  `whatsmeow_jobs` (`source_job_serial` = `jobs.serial`), returns
  `ErrDispatched` so the `jobs` row stays `claimed`. No WhatsApp state —
  **safe to scale horizontally** (`WORKER_REPLICAS` / `--scale worker=N`).
- `cmd/whatsapp_worker` — **stateful executor**: owns WhatsMeow clients and the
  `DeviceManager` (actor model), claims `whatsmeow_jobs`, executes, writes
  terminal status + `result.wa_message_id` back to `jobs`. **Strictly one
  instance** — every instance opens live WhatsApp connections to the same
  accounts; more than one risks an account ban.
- `cmd/migrate` — golang-migrate runner against `shared/db/migrations/`.

Hexagonal layering: `entity ← ports ← service ← adapters`, `cmd` is the
composition root; compile-time port assertions; test pyramid unit → functional →
real-DB integration (127+ tests, gofmt/vet clean).

### Key implementation notes

- **Queue consumer**: pgx `FOR UPDATE SKIP LOCKED` claim; exponential backoff;
  fails after `MAX_ATTEMPTS`.
- **DeviceManager**: devices provisioned dynamically from the `sessions`
  table; on boot syncs stored sessions → `EnsureDevice` → `ConnectStored`;
  lazy ensure in the executor.
- **Inbound**: WhatsMeow events → handler → WABA-shaped payload (service
  layer; WhatsMeow types stay in the adapter) → fetch webhook config via the
  dashboard internal API → forward with `X-Hub-Signature-256` HMAC, bounded
  retry.
- **Heartbeat**: `cmd/whatsapp_worker` batch-refreshes `sessions.last_seen_at`
  via the dashboard internal API.
- **WhatsMeow store**: Postgres (`WHATSMEOW_STORE_DSN`, falls back to
  `SUPABASE_DSN`); `CGO_ENABLED=0` static binaries.

## Configuration

Worker env (via `internal/config/config.go`, `Load`): `SUPABASE_DSN`,
`WHATSMEOW_STORE_DSN`, `BUSINESS_ACCOUNT_ID`, `API_URL`, `INTERNAL_TOKEN`,
`MIGRATIONS_DIR`, `POLL_INTERVAL`, `MAX_ATTEMPTS`, `WEBHOOK_CONFIG_TTL`,
`HEARTBEAT_INTERVAL`. `cmd/worker` ignores the WhatsMeow/session-related vars.

Dashboard env (root `.env`): `DATABASE_URL`, `API_AUTH_TOKEN`,
`INTERNAL_TOKEN`, `API_KEY_ENCRYPTION_KEY` (+ `_PREVIOUS` for rotation),
`NEXT_PUBLIC_API_TOKEN`, `API_KEY_ENV`, `SEND_TIMEOUT_MS`, `RESULT_POLL_MS`,
`HEARTBEAT_TTL_MS`, `CORS_ORIGINS`, `WORKER_REPLICAS` (compose).

## Local stack (docker compose)

`postgres` (host 5433), one-shot `migrate` (worker image), `dashboard` (3000),
`worker`, `whatsapp_worker`. Both app images build from the repo root context;
the worker image bundles `shared/db/migrations/` to `/app/migrations`.
After adding a migration: `docker compose build migrate` then
`docker compose up -d migrate postgres`.

## Deferred work

Public send route (`POST /messages`), webhook signing, idempotency, dead-letter
queue, contacts, groups, media, health/metrics endpoints, OpenAPI spec, SDK,
examples. Tracked in `ROADMAP.md` (phases 3–5).

## Verification

- Worker: `go test ./...`, `go vet ./...`, `gofmt -l .`, `CGO_ENABLED=0 go
  build ./cmd/...` from `services/worker/`.
- Dashboard: `npm run build` / `npm run test` via Turborepo.
- Compose: `docker compose config` validates interpolation.
