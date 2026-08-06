# Worker Split — Stateless Dispatcher + Stateful WhatsApp Worker

## Motivation

The current `services/worker` binary bundles three responsibilities in one
process: poll the `jobs` queue, route/handle each job, and own stateful
WhatsMeow clients per WhatsApp channel. The WhatsMeow ownership makes the
whole process stateful — it cannot be horizontally scaled for job intake,
and a redeploy reconnects every WhatsApp session.

This plan splits the single binary into two:

- **`cmd/worker`** — stateless dispatcher. Polls `jobs`, validates, and
  hands off to a second queue (`whatsmeow_jobs`). No WhatsMeow, no
  websockets, no in-memory channel state. Horizontally scalable.
- **`cmd/whatsapp_worker`** — stateful executor. Owns the `DeviceManager`
  and WhatsMeow clients, polls `whatsmeow_jobs`, and executes send / pair /
  logout. Single-instance for now (per-channel ownership is a later, larger
  milestone if HA is ever required).

The two binaries communicate only through the `whatsmeow_jobs` table in
Postgres/Supabase. Each has its own poll loop and its own
`FOR UPDATE SKIP LOCKED` claim against its own table.

## Architecture

```
API  ──enqueue──▶  jobs  ──▶  cmd/worker (stateless, N replicas)
                                   │ dispatch (INSERT into whatsmeop_jobs)
                                   │ mark jobs row claimed (NOT succeeded)
                                   ▼
                            whatsmeow_jobs  ──▶  cmd/whatsapp_worker (stateful, 1 instance)
                                                        │ execute on WhatsMeow
                                                        │ write result back to jobs (succeeded/failed)
                                                        │ mark whatsmeow_jobs succeeded/failed
                                                        ▼
                                                   WhatsMeow clients
```

### Result write-back (NOT fire-and-forget)

The API's existing synchronous-result contract depends on `jobs.result.wa_message_id`
(`services/api/src/service/send-message.ts:40-47`): it polls `jobs` by `serial`,
waits for `status='succeeded'`, and returns **500** if `result` has no
`wa_message_id`. Fire-and-forget at the dispatch boundary would mark `jobs`
`succeeded` with `result=null` → every send returns 500.

So the split preserves the contract with **result write-back**:

- `cmd/worker` marks the `jobs` row `claimed` (not `succeeded`) after
  inserting the `whatsmeow_jobs` row. The `jobs` row stays `claimed` until
  the whatsapp worker finishes.
- `cmd/whatsapp_worker`, on completion, writes `result` back to the
  original `jobs` row (via a `jobs` `Store`) and marks it `succeeded` /
  `failed`. Then it marks the `whatsmeow_jobs` row `succeeded` / `failed`.
- The API is unchanged — it still polls `jobs` and gets the wamid.

Correlation: `whatsmeow_jobs` carries a `source_job_serial uuid` column
referencing `jobs.serial`. The dispatcher sets it; the whatsapp executor
uses it to write the result back.

Pair/logout return `202` with `job_serial` and the API does not poll for a
result, so fire-and-forget would be safe for them — but write-back is used
for all three for simplicity and uniformity (costs nothing extra).

### Inbound event flow (unchanged)

Inbound events flow through `whatsmeow/handler.go` → `MessageService.Inbound`
→ webhook forward. This lives entirely in `cmd/whatsapp_worker` (it owns
the WhatsMeow clients and event handlers). `cmd/worker` is not involved in
inbound. The split does not change inbound behavior.

### Contract between the two binaries

The `whatsmeow_jobs` row is the only shared interface. It mirrors the
`jobs` schema (see M13) plus a `source_job_serial` correlation column.
`cmd/worker` owns writing this shape; `cmd/whatsapp_worker` owns reading
and executing it. The `payload` JSONB is the interface contract — it must
be documented in `docs/services/worker/`.

## Milestones

### M13 — `whatsmeow_jobs` migration + second `Store` instance **(Completed — commit `52220d1`)**

Status: migration `000007_create_whatsmeow_jobs.{up,down}.sql` landed; `Store`
parameterized via `table` constructor constant with `NewStoreWithPool` for
shared-pool reuse. Verified: gofmt clean, `go test ./...` 101 passed / 12
packages, `go vet ./...` clean, `go build ./...` OK. Docker migrate up/down
deferred (daemon down at the time).

**Migration (`shared/db/migrations/000007_create_whatsmeow_jobs`):**

Clone `000001_create_jobs.up.sql` verbatim, rename the table, add
`source_job_serial`, keep every column the parameterized `Store` SQL
references. Status vocabulary must match `jobs` exactly
(`pending`/`claimed`/`succeeded`/`failed`) — `Store.Complete` writes
`'succeeded'` literally (`store.go:113`).

```sql
create table if not exists public.whatsmeow_jobs (
    id                bigserial primary key,
    serial            uuid not null default gen_random_uuid(),
    source_job_serial uuid,                       -- references jobs.serial (no FK; jobs row may be GC'd)
    type              text not null default 'send_message',
    phone_number_id   text not null,
    payload           jsonb not null,
    status            text not null default 'pending'
                      check (status in ('pending', 'claimed', 'succeeded', 'failed')),
    attempts          int  not null default 0,
    max_attempts      int  not null default 3,
    available_at      timestamptz not null default now(),
    claimed_by        text,
    claimed_at        timestamptz,
    completed_at      timestamptz,
    last_error        text,
    result            jsonb,
    idempotency_key   text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    deleted_at        timestamptz
);

create unique index if not exists whatsmeow_jobs_serial_idx
    on public.whatsmeow_jobs (serial);
create unique index if not exists whatsmeow_jobs_idempotency_key_idx
    on public.whatsmeow_jobs (idempotency_key) where idempotency_key is not null;
create index if not exists whatsmeow_jobs_claim_idx
    on public.whatsmeow_jobs (status, available_at, created_at);
create index if not exists whatsmeow_jobs_source_idx
    on public.whatsmeow_jobs (source_job_serial) where source_job_serial is not null;

create trigger whatsmeow_jobs_set_updated_at
    before update on public.whatsmeow_jobs
    for each row execute function public.set_updated_at();
```

Down migration drops the table. (Stale-claim reaping / `claim_expires_at`
is deferred to a later reliability milestone — single-instance
`cmd/whatsapp_worker` means a crash leaves `whatsmeow_jobs` rows stuck in
`claimed`, same latent bug that exists in `jobs` today. Noted here so it
isn't thought forgotten.)

**Second `Store` instance (not a `table` field):**

The `Consumer` already depends on `ports.JobStore` (`consumer.go:24`), not
the concrete `Store` — the interface is the seam. So:

- Add a `table string` field to `Store` set **only** at construction (a
  hardcoded constant, never env-derived — table names can't be `$1`
  parameterized, so this avoids an injection vector). Every SQL literal
  `'jobs'` becomes `s.table`.
- Constructor: `NewStore(pool, hostname, table string) *Store`.
- `cmd/worker` constructs `NewStore(pool, host, "jobs")`.
- `cmd/whatsapp_worker` constructs `NewStore(pool, host, "whatsmeow_jobs")`
  for its own queue **and** a second `NewStore(pool, host, "jobs")` for
  result write-back.
- `Consumer` is unchanged (it already takes `ports.JobStore`).
- Update `store_integration_test.go` constructor call (`store_integration_test.go:96`).
  `consumer_test.go` uses a fake `fakeJobStore` and is unaffected.

**Verify (M13):**
- `gofmt`, `go test ./...`, `go vet ./...` from `services/worker/`.
- `docker compose build migrate` then `docker compose up -d migrate
  postgres postgrest` (migrations are baked into Docker images per
  `shared/AGENTS.md`) — `whatsmeow_jobs` created and dropped cleanly via
  up/down.
- Existing queue store integration test still passes with `table: "jobs"`.

### M14 — Split executor + two `cmd/` entrypoints + build/deploy + docs **(Completed)**

Status: `Dispatcher`, `WhatsAppExecutor`, `cmd/worker`, `cmd/whatsapp_worker`,
`ports.ErrDispatched`, `Store.Enqueue`, Consumer sentinel branch, package.json /
Dockerfile / compose split, and docs all landed. Legacy `cmd/main.go` +
`internal/service/executor.go` **kept** — the plan gates their deletion on the
docker e2e, which is deferred (daemon down; user chose "commit now, defer
e2e").

Verified (2026-08-06): gofmt clean; `go test ./...` 102 passed / 14 packages
(incl. new consumer dispatched-branch test); `go vet ./...` clean;
`go build ./...` OK; `CGO_ENABLED=0 go build ./cmd/...` OK (cmd, cmd/worker,
cmd/whatsapp_worker, cmd/migrate); `go mod tidy` no-op; `docker compose config
--quiet` OK; turbo `npm run build` 3/3 tasks OK. Not run: compose up e2e
(daemon down) — see "Out of Scope"/next steps below.

This milestone combines the executor split and the wiring into one
shippable unit. M14 alone (executor split with nothing wired) would leave
dead code and isn't shippable per the repo's milestone rules, so the
wiring lands in the same milestone.

**`Dispatcher` (stateless handler, `internal/service/dispatcher.go`):**
- Implements the same handler interface `Consumer` already calls.
- For each job type:
  - `send_message`: validate `OutboundMessage` payload (move
    `validateOutboundMessage` from `executor.go` to a shared location in
    `internal/service/` so both handlers can use it) → `INSERT INTO
    whatsmeow_jobs (type, phone_number_id, payload, source_job_serial,
    idempotency_key)` → mark original `jobs` row `claimed` (NOT
    `succeeded` — the whatsapp worker writes the result back later).
  - `pair`: `INSERT INTO whatsmeow_jobs (type='pair', phone_number_id,
    payload, source_job_serial)` → mark original `jobs` row `claimed`.
  - `logout`: `INSERT INTO whatsmeow_jobs (type='logout',
    phone_number_id, source_job_serial)` → mark original `jobs` row
    `claimed`.
- **Invariant:** `Dispatcher` writes only to `whatsmeow_jobs` and updates
  `jobs` status to `claimed`. It must **never** touch `sessions` or
  `session_qr_codes`. Read-only session lookups to enrich/validate the
  payload are allowed but must be documented as read-only.
- Does **not** import `internal/adapters/whatsmeow`.

**`WhatsAppExecutor` (stateful handler,
`internal/service/whatsapp_executor.go`):**
- Same logic as the current `JobExecutor`, but reads from `whatsmeow_jobs`.
- `send_message`: `ensureDevice` (lazy provision) →
  `DeviceManager.Sender(phoneNumberID).Send(payload)` → write `result`
  (with `wa_message_id`) back to the original `jobs` row (via the `jobs`
  `Store`, keyed by `source_job_serial`) and mark it `succeeded` (or
  `failed` with `attempts` increment + `last_error`) → mark
  `whatsmeow_jobs` row `succeeded` / `failed`.
- `pair`: `ensureDevice` → `DeviceManager.Pair` → save QR to
  `SessionStore` → send webhook to API → write back to `jobs` → mark
  `whatsmeow_jobs` done.
- `logout`: `DeviceManager.Logout` → mark session `logged_out` → write
  back to `jobs` → mark `whatsmeow_jobs` done.
- Imports `internal/adapters/whatsmeow` and the `jobs` `Store` (for
  write-back).

**`cmd/worker/main.go` (stateless):**
```
config (Supabase DSN, poll interval, max attempts)
→ Store{table: "jobs"}
→ Consumer → Dispatcher handler
→ graceful shutdown (stop consumer, cancel ctx)
```
No `DeviceManager`, no WhatsMeow store, no `SessionStore`, no heartbeat.

**`cmd/whatsapp_worker/main.go` (stateful):**
```
config (Supabase DSN, WhatsMeow store DSN, ...)
→ WhatsMeow SQL container
→ SessionStore
→ DeviceManager
→ boot: ListSessions → EnsureDevice → ConnectStored
→ Store{table: "whatsmeow_jobs"} (own queue) + Store{table: "jobs"} (write-back)
→ Consumer → WhatsAppExecutor handler
→ heartbeat goroutine
→ graceful shutdown (stop consumer → cancel actors → wait done → disconnect)
```
This is the current `cmd/main.go` logic, minus the `jobs` consumer, plus
the `whatsmeow_jobs` consumer + `jobs` write-back Store.

**Keep `cmd/main.go` until M14 e2e passes**, then delete it in the same
commit. A deleted `cmd/main.go` mid-milestone with a broken new entrypoint
is unrecoverable without git revert.

**Build/deploy wiring:**
- `services/worker/package.json` scripts:
  - `build`: build both binaries (`go build -o bin/worker ./cmd/worker`
    and `go build -o bin/whatsapp_worker ./cmd/whatsapp_worker`).
  - `dev:worker`, `dev:whatsapp`, `dev` (concurrently).
- `docker-compose.yml`: split the single `worker` service into
  `worker` and `whatsapp_worker`, each pointing at its own binary.
- Dockerfile: build both binaries in the build stage, copy both into
  the final image; the compose `command:` selects which one to run.

**Docs:**
- `services/worker/AGENTS.md` — document the two-binary split, which
  packages each imports, the `whatsmeow_jobs` contract, the result
  write-back flow.
- `docs/services/worker/` — new section doc describing the two binaries,
  the `whatsmeow_jobs` queue, the dispatch/execute flow, the
  `source_job_serial` correlation, and the `payload` JSONB shape per job
  type.
- `docs/services/README.md` and `docs/README.md` — keep index links
  accurate.
- `HANDOFF.md` — update with M13–M14 status and verification evidence.

**Verify (M14):**
- `gofmt`, `go test ./...`, `go vet ./...`.
- `CGO_ENABLED=0 go build ./cmd/worker` and
  `CGO_ENABLED=0 go build ./cmd/whatsapp_worker` both succeed.
- `npm run build` / `npm run test` / `npm run lint` at repo root
  (turbo) pass.
- `docker compose up --build -d` — both services healthy.
- e2e: `POST /:phone_number_id/messages` → `jobs` enqueued →
  `cmd/worker` claims + inserts `whatsmeow_jobs` + marks `jobs` `claimed`
  → `cmd/whatsapp_worker` claims + executes (or fails gracefully if no
  paired device) + writes result back to `jobs` + marks `jobs`
  `succeeded`/`failed` → API polls `jobs` to terminal with wamid (or
  error). Confirms the full
  API → jobs → worker → whatsmeow_jobs → whatsapp_worker → WhatsMeow →
  jobs write-back chain.
- Confirm `cmd/worker` can be scaled to 2 replicas in compose without
  double-processing (FOR UPDATE SKIP LOCKED).

## Out of Scope

- Per-channel ownership / leader election for `cmd/whatsapp_worker` HA
  (separate future milestone).
- Job lease TTL / reaper for stale `claimed` rows in either `jobs` or
  `whatsmeow_jobs` (separate reliability milestone; same latent bug
  exists in `jobs` today).
- Parallelizing the sequential `processOnce` loop (separate throughput
  milestone).
- Inbound event dedup.
- The `handlePairing` status race (`executor.go:70-101`, flagged in prior
  review) — moved verbatim into `WhatsAppExecutor`; not a regression but
  not fixed here.
- The orphaned `internal/adapters/channel/channel.go` router — dead code
  today, stays dead after the split.

## Acceptance Criteria

- Two binaries build and run independently from `services/worker/`.
- `cmd/worker` has no WhatsMeow import and can run N replicas.
- `cmd/whatsapp_worker` owns all WhatsMeow state and stays single-instance.
- A send job flows API → `jobs` → `cmd/worker` (marks `jobs` `claimed`) →
  `whatsmeow_jobs` → `cmd/whatsapp_worker` → WhatsMeow → result written
  back to `jobs` (`succeeded` with wamid, or `failed`) → API polls to
  terminal. The existing API synchronous-result contract is preserved.
- A pair job flows the same way and produces a QR + webhook.
- `gofmt`, `go test ./...`, `go vet ./...` clean; turbo build/test/lint
  pass; compose stack runs both services.