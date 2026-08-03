# Split Architecture: Hono API + Supabase Transport + Go Worker

## Objective

Split the current single Go service into three components:

- **API (Node.js, Hono, Vercel-compatible)** — public WABA-compatible surface.
  Validates send requests, enqueues jobs, waits for the worker result, and
  returns the official 200 WABA response shape. Serves webhook configuration.
- **Worker (Golang + WhatsMeow)** — one process, many WhatsApp connections
  (multi-device). Polls Supabase for jobs and executes them. Handles inbound
  events and forwards them to customer webhooks.
- **Transport (Supabase)** — durable job queue and webhook configuration.

## Repo Layout (Turborepo Monorepo)

```text
.
├── apps/                    # UI & frontend (placeholder for now)
│   └── .gitkeep
├── services/
│   ├── api/                 # Node.js Hono API (Vercel-compatible)
│   └── worker/              # Go + WhatsMeow worker (existing code moves here)
├── shared/
│   └── db/
│       └── migrations/      # SQL migrations (golang-migrate format)
├── package.json             # Turborepo root workspace
├── turbo.json
└── (existing Go files → services/worker/, own go.mod)
```

- Turborepo orchestrates `apps/*` and `services/api` (npm workspaces). The Go
  worker participates through `package.json` scripts (`build`, `test`, `dev`)
  that call `go build` / `go test`, declared as custom turbo tasks.
- All existing Go code (`cmd/`, `internal/`, `docs/`, tests, AGENTS.md,
  HANDOFF.md) moves to `services/worker/`.
- All database migrations live in `shared/db/migrations` in golang-migrate
  format and are executed with golang-migrate (see Transport section).
- `apps/` only gets `.gitkeep` for now; UI work is deferred.

## Decisions (confirmed)

| # | Decision |
| - | -------- |
| 1 | **Response: synchronous `200`** with the official WABA envelope including the real `wamid.…` message ID. |
| 2 | **Monorepo with Turborepo**; `apps/` (UI, gitkeep) + `services/` (api, worker). |
| 3 | **API framework: Hono** (compatible with Vercel deployment). |
| 4 | **Wake-up: polling**; Supabase Realtime only if needed later. |
| 5 | **Multi-device: 1 worker, N WhatsMeow connections**, routed by `phone_number_id`. |

## Flow Diagrams

### Overall

```mermaid
flowchart LR
    Client["API Client"]
    HTTP["API Server<br/>(Node.js Hono)"]
    Queue[("Supabase<br/>Transport Queue")]
    Worker["Worker<br/>(Golang + WhatsMeow, multi-device)"]
    Webhook["Customer Webhook"]

    %% Outbound
    Client -->|"Send Message Request"| HTTP
    HTTP -->|"Enqueue Job"| Queue
    Worker -->|"Poll Jobs"| Queue
    Worker -->|"Send WhatsApp Message"| WA[(WhatsApp)]

    %% Inbound
    WA -->|"Incoming Message"| Worker
    Worker -->|"Get Webhook Configuration"| HTTP
    HTTP -->|"Webhook URL"| Worker
    Worker -->|"POST Webhook Event"| Webhook
```

### Outbound (Send Message) — synchronous 200

```mermaid
sequenceDiagram
    participant C as API Client
    participant H as API Server (Hono)
    participant S as Supabase (Transport)
    participant W as Worker (Go + WhatsMeow)
    participant A as WhatsApp

    C->>H: POST /<phone_number_id>/messages (WABA body)
    H->>H: Validate WABA shape + bearer auth
    H->>S: INSERT job (status=pending, phone_number_id)
    loop poll job row every ~250ms until deadline (~25s)
        S-->>H: job status
    end
    alt succeeded
        H-->>C: 200 WABA envelope (messages[0].id = real wamid)
    else failed / deadline
        H-->>C: WABA-shaped error envelope
    end

    %% worker side (async)
    W->>S: claim: UPDATE ... FOR UPDATE SKIP LOCKED
    S-->>W: claimed job
    W->>W: resolve connection by phone_number_id
    W->>W: map WABA payload → WhatsMeow message
    W->>A: SendMessage (long-lived connection)
    A-->>W: wamid (real WhatsApp message ID)
    W->>S: complete_job (succeeded, result: { wa_message_id })
    alt send failed
        W->>S: retry with backoff (attempts+1, available_at+delay)
    end
```

### Inbound (Webhook Event)

```mermaid
sequenceDiagram
    participant A as WhatsApp
    participant W as Worker (Go + WhatsMeow)
    participant H as API Server (Hono)
    participant C as Customer Webhook

    A->>W: Incoming message event (on device connection)
    W->>W: Translate event → domain.InboundEvent (existing handler)
    W->>H: GET /internal/webhook-config?phone_number_id=...
    H-->>W: { webhook_url, webhook_secret }
    W->>W: Build WABA webhook payload (existing service)
    W->>C: POST payload (+ X-Hub-Signature-256 HMAC)
    C-->>W: 2xx / non-2xx
    alt non-2xx or transport error
        W->>W: retry with backoff / drop per policy
    end
```

## Components

### 1. Transport (Supabase)

#### Migrations (golang-migrate)

- Files live in `shared/db/migrations/`, shared by api and worker:
  `000001_create_jobs.up.sql` / `000001_create_jobs.down.sql`,
  `000002_create_webhook_configs.up.sql` / `000002_create_webhook_configs.down.sql`.
- Executed with golang-migrate. The worker runs `up` on startup (or via a
  dedicated `cmd/migrate`) using the `file://` source pointed at
  `MIGRATIONS_DIR` (default `shared/db/migrations`) against `SUPABASE_DSN`.
  CLI alternative: `migrate -path shared/db/migrations -database "$SUPABASE_DSN" up`.
- Applied versions are tracked in the `schema_migrations` table, so reruns are
  idempotent.

#### Table Convention (all tables)

Every table carries the same mandatory columns:

| Column | Type | Purpose |
| ------ | ---- | ------- |
| id | `bigserial` primary key | native row counter only; never used for relationships |
| serial | `uuid not null default gen_random_uuid()` | stable unique identifier used for relationships, updates, and external references |
| created_at | `timestamptz not null default now()` | row creation |
| updated_at | `timestamptz not null default now()` | auto-maintained by the `set_updated_at()` trigger on UPDATE |
| deleted_at | `timestamptz` | soft delete; queries filter `deleted_at is null` |

- `serial` is unique per table and is the key for every update, delete, and
  relationship reference; `id` stays opaque to the application.
- Soft-deleted rows keep their `serial` and `idempotency_key` uniqueness.

Table `public.jobs`:

```sql
create table if not exists public.jobs (
    id              bigserial primary key,
    serial          uuid not null default gen_random_uuid(),
    type            text not null default 'send_message',
    phone_number_id text not null,
    payload         jsonb not null,
    status          text not null default 'pending'
                    check (status in ('pending', 'claimed', 'succeeded', 'failed')),
    attempts        int  not null default 0,
    max_attempts    int  not null default 3,
    available_at    timestamptz not null default now(),
    claimed_by      text,
    claimed_at      timestamptz,
    completed_at    timestamptz,
    last_error      text,
    result          jsonb,
    idempotency_key text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    deleted_at      timestamptz
);

create unique index if not exists jobs_serial_idx
    on public.jobs (serial);
create unique index if not exists jobs_idempotency_key_idx
    on public.jobs (idempotency_key) where idempotency_key is not null;
create index if not exists jobs_claim_idx
    on public.jobs (status, available_at, created_at);

create trigger jobs_set_updated_at
    before update on public.jobs
    for each row execute function public.set_updated_at();
```

Table `public.webhook_configs` (managed through the API; read by the worker via
the API, per the chosen flow):

```sql
create table if not exists public.webhook_configs (
    id              bigserial primary key,
    serial          uuid not null default gen_random_uuid(),
    phone_number_id text not null unique,
    webhook_url     text not null,
    webhook_secret  text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    deleted_at      timestamptz
);

create unique index if not exists webhook_configs_serial_idx
    on public.webhook_configs (serial);

create trigger webhook_configs_set_updated_at
    before update on public.webhook_configs
    for each row execute function public.set_updated_at();
```

- **Write (API):** `supabase-js` REST `INSERT` with an idempotency key.
- **Claim (worker):** raw SQL via `pgx` (Supabase is Postgres; no RPC needed):

```sql
update public.jobs
   set status = 'claimed', claimed_by = $1, claimed_at = now()
 where id = (
     select id from public.jobs
      where status = 'pending' and available_at <= now()
      order by created_at
      limit 1
      for update skip locked
 )
returning *;
```

- **Complete (by serial):** `update public.jobs set status = $2,
  completed_at = now(), last_error = $3, result = $4
  where serial = $1 and deleted_at is null;`
- Retry semantics: on failure set `status='pending'`, `attempts = attempts + 1`,
  `available_at = now() + 2^attempts seconds`; when `attempts >= max_attempts`
  mark `status='failed'` (dead-letter).

### 2. services/api (Node.js, Hono)

- Hono app, runnable on Node (`@hono/node-server`) and deployable to Vercel.
- `supabase-js` client for enqueue + result polling.
- Endpoints:
  - `POST /:phone_number_id/messages` — bearer auth (`API_AUTH_TOKEN`), WABA
    shape validation, optional idempotency key, `INSERT` job, then **poll the
    job row until deadline** and return the official 200 envelope with the real
    `wamid` from the worker result, or a WABA-shaped error envelope on failure
    or timeout.
  - `GET /messages/:id` — job status mapped to a WABA-shaped status (phase 2).
  - `GET /internal/webhook-config?phone_number_id=...` — worker-facing, protected
    by `INTERNAL_TOKEN`; returns `{ webhook_url, webhook_secret }`.
  - (later) CRUD for webhook configs.
- Config: `PORT`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `API_AUTH_TOKEN`,
  `INTERNAL_TOKEN`, `SEND_TIMEOUT_MS` (default 25000), `RESULT_POLL_MS`
  (default 250).

> Caveat: Vercel serverless functions have execution-time limits (Hobby ~10s,
> higher on Pro). A synchronous wait of ~25s may not fit on Vercel; if that
> becomes a constraint, add async mode (`202` + status endpoint) behind a
> config flag.

### 3. services/worker (Go)

Reuses most of the existing Go code — it moves to `services/worker/`, with the
Echo HTTP adapter removed.

- **Removed:** `internal/adapters/httpapi/` (Echo), its `cmd/main.go` wiring,
  HTTP-side config (`PORT`, `API_AUTH_TOKEN`).
- **Kept:** `adapters/whatsmeow` (event translation + dispatch), `service/`
  (WABA payload mapping, outbound validation), `adapters/webhook` (forwarding +
  HMAC), `domain`, `ports`, tests.
- **New — multi-device connection manager:** `ClientRegistry` keyed by
  `phone_number_id`. Each device owns a WhatsMeow client with its own bounded
  outbound channel and worker goroutine. Devices come from config
  (e.g., `WABA_DEVICES=62812...,62813...`); QR login and reconnect handled per
  device. Inbound events keep the existing anti-corruption handler, now wired
  per device.
- **New — queue consumer:** `internal/adapters/queue` (pgx) — poll loop
  (`POLL_INTERVAL`, default 1s), claim with `SKIP LOCKED`, complete/retry.
- **New — outbound executor (service layer):** on claimed job → resolve the
  connection by `phone_number_id` → validate → `ports.MessageSender` → store
  the real WhatsApp message ID in `result`.
- **New — webhook config provider:** `ports.WebhookConfigProvider` +
  `internal/adapters/apiconfig` — before forwarding an inbound event, call
  `GET {API_URL}/internal/webhook-config` with `INTERNAL_TOKEN`; cache per
  `phone_number_id` with a short TTL.
- **Inbound flow:** WhatsMeow event → existing translation → fetch config from
  API → build WABA payload → forward via existing webhook adapter (HMAC with
  returned secret); retry policy on non-2xx.
- **Shutdown:** stop poll loop → drain per-device queues → disconnect all
  WhatsMeow clients.
- Config: `SUPABASE_DSN`, `MIGRATIONS_DIR`, `POLL_INTERVAL`, `API_URL`,
  `INTERNAL_TOKEN`, `MAX_ATTEMPTS`, `WABA_DEVICES` + existing WhatsMeow/WABA
  env vars.

### 4. Dev Environment (Docker Compose + Dockerfiles)

Local dev/testing stack via Docker Compose. `docker-compose.yml` at the repo
root. Both app images build from the **repo root context** (the worker image
must bundle `shared/db/migrations/` for `cmd/migrate`).

```text
compose services
  postgres   postgres:16-alpine, healthcheck pg_isready, volume, port 5432
  postgrest  PostgREST emulating Supabase's REST layer for supabase-js
  migrate    worker image, one-shot `cmd/migrate -direction up`
  api        services/api image, PORT 3000, SUPABASE_URL -> postgrest
  worker     services/worker image
```

#### postgres

- `postgres:16-alpine`, `POSTGRES_DB=waba`, named volume for persistence,
  port `5432` published for local tooling, `pg_isready` healthcheck.

#### migrate (one-shot)

- Built from the worker image; runs `/app/migrate -direction up` with
  `SUPABASE_DSN` + `MIGRATIONS_DIR=/app/migrations`.
- `api` and `worker` both `depends_on` it with `service_completed_successfully`,
  and postgres with `service_healthy` — schema is applied before anything reads.

#### worker image

- Multi-stage: `golang:1.26` build stage → slim runtime.
- Builds both binaries: `/app/worker` (cmd) and `/app/migrate` (cmd/migrate);
  copies `shared/db/migrations/` to `/app/migrations`.
- **Store decision (resolved):** the WhatsMeow device store moves from
  SQLite (`mattn/go-sqlite3`) to Postgres (whatsmeow `sqlstore` "postgres"
  dialect). This removes CGO, giving a `CGO_ENABLED=0` static binary, and
  stores device sessions in the transport DB (`WHATSMEOW_STORE_DSN`, falls
  back to `SUPABASE_DSN`).

#### api image

- Multi-stage: `node:22-alpine` build stage → runtime. Root-context copy of
  `package.json` + `package-lock.json` + `turbo.json` + `services/api`, then
  `npm ci`, `npm run build`, runtime stage with `dist/` + production deps,
  `CMD ["node", "dist/index.js"]`.

#### API DB access decision

`supabase-js` is a PostgREST client; a bare Postgres container cannot serve
it. Two options:

- **Decision (resolved): option (a) PostgREST in compose.** Add
  `postgrest/postgrest` with `PGRST_DB_URI`, `PGRST_DB_ANON_ROLE`,
  `PGRST_JWT_SECRET` so the same `supabase-js` code runs locally and against
  Supabase (RLS-ready). Local anon/service keys are dev placeholders; the
  anon role is the superuser `postgres` for dev simplicity.

#### compose wiring

- `api` env: `PORT`, `SUPABASE_URL` (+ keys, per decision above), `API_AUTH_TOKEN`,
  `INTERNAL_TOKEN`, `SEND_TIMEOUT_MS`.
- `worker` env: `SUPABASE_DSN`, `MIGRATIONS_DIR=/app/migrations`, `POLL_INTERVAL`,
  `API_URL=http://api:3000`, `INTERNAL_TOKEN`, `MAX_ATTEMPTS`, `WABA_DEVICES`,
  WhatsMeow store DSN (per CGO decision), and the existing WABA webhook vars.

## Milestones

1. **M1 — Monorepo restructure:** Turborepo root (`package.json`, `turbo.json`),
   `apps/.gitkeep`, move Go code to `services/worker/`, scaffold
   `services/api` (Hono hello-world + turbo tasks). Go tests still green.
2. **M2 — Supabase schema + migrations (Completed):** `shared/db/migrations`
   (golang-migrate format) for `jobs` + `webhook_configs`; `cmd/migrate` in
   the worker (`SUPABASE_DSN`, `MIGRATIONS_DIR`, pgx5 driver). Verified against
   a throwaway postgres:16 container.
3. **M3 — Dev environment (Docker Compose, Completed):** compose with
   postgres + postgrest + one-shot migrate + dockerized `services/api` and
   `services/worker`. Decisions resolved: WhatsMeow store → Postgres
   (CGO-free image), API DB access → PostgREST for supabase-js parity.
   Stack runs with `docker compose up --build`.
4. **M4 — services/api:** enqueue + synchronous result wait + auth + internal
   webhook-config API; API tests (Hono + Vitest).
5. **M5 — services/worker:** `ClientRegistry` (multi-device) + queue consumer +
   outbound executor + inbound config provider/forwarding; Go tests.
6. **M6 — Integration + cleanup:** remove Echo adapter remnants, end-to-end
   run in the compose stack, update `README.md`, `HANDOFF.md`, and this plan;
   `gofmt`/`go test ./...`/`go vet ./...` + API test run.

## Acceptance Criteria

- `POST /:phone_number_id/messages` returns **200** with the official WABA
  envelope containing the real `wamid.…` from WhatsMeow, after the worker sends.
- One worker process manages N WhatsApp connections; jobs route to the correct
  device by `phone_number_id`.
- Incoming WhatsApp message → worker fetches webhook config from the API →
  WABA payload forwarded to the customer webhook with correct HMAC.
- No WhatsMeow connection is created per job.
- Failed jobs retry with backoff and end in `failed` after max attempts.
- Graceful shutdown without losing in-flight work.
- Go checks (`gofmt`, `go test ./...`, `go vet ./...`) and API tests pass.

## Open Items

- Vercel deployment target — if the API runs on Vercel serverless, sync-wait
  may hit function duration limits (async mode as fallback).
- Webhook config management surface (CRUD API/UI in `apps/` later).
- Device provisioning flow (registering phone numbers, QR login lifecycle,
  reconnection policy).

## Verification Log

| Date | Milestone | Command | Result |
| ---- | --------- | ------- | ------ |
| 2026-08-03 | M1 | `npm run build`, `npm run test` (turbo); `go vet ./...` | 2/2 build, 2/2 test, vet clean |
| 2026-08-03 | M2 | `go test ./...`, `go vet ./...` (services/worker) | 32 tests, 9 packages; vet clean |
| 2026-08-03 | M2 | `cmd/migrate` against postgres:16 container | up→v2, idempotent "no change", down→v1, up→v2 |
| 2026-08-03 | M3 | `CGO_ENABLED=0 go build ./...` (services/worker) | CGO-free build OK (lib/pq store switch) |
| 2026-08-03 | M3 | `docker compose up --build -d` + curl checks | postgres healthy, migrate→v2, postgrest 200, api `{"ok":true}`; worker up + QR linking. Fixes during verify: postgres host port 5433 (5432 taken), `?sslmode=disable` in DSNs, PGRST_JWT_SECRET >=32 bytes |
| 2026-08-03 | M4 | `npm run build` + `npm run test` --workspace /api | tsc clean; 39 tests pass (app 29, transport 10) |
| 2026-08-03 | M4 | `docker compose build api` | API image rebuilds OK with /supabase-js |
| 2026-08-03 | M4 | hexagonal refactor: domain/ports/service/adapters | tsc clean; 51 tests pass (http 31, send 8, webhook 2, transport 10); no framework imports below adapters |
