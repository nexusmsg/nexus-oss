# Observability: Developer Dashboard Activity Log

## Objective

Add an Observability page to the developer dashboard (Nexus) where important
activities can be viewed as a list/table, each item clickable with a detail
view. Trace relationships between activities when they exist:

```text
API Request
    ↓
Nexus / Message
    ↓
WhatsApp Event
    ↓
Webhook
```

Initial activity kinds: API requests into Nexus, events coming from WhatsApp,
and webhook deliveries/events. Experience modeled on Stripe's developer
dashboard: inspect an individual operation/event and understand what happened
and how it relates to other operations.

Do not assume an observability framework, event bus, table schema, or
architecture — the design below is the simplest approach that fits the existing
codebase.

## Current State (facts that shape the design)

Two-sided system sharing one Postgres:

- **Dashboard** (`apps/dashboard`, Next.js 16 + Drizzle/pg): public WABA-shaped
  API (`/api/v1/sessions|webhooks|api-keys/**`) + management UI. Route handlers
  are thin: `authorizeApi()` → `composeServices(config)` → service →
  `DrizzleTransport` (single DB adapter implementing `JobTransport`,
  `SessionTransport`, `WebhookConfigManagementTransport`, `ApiKeyTransport`).
- **Worker** (`services/worker`, Go + WhatsMeow, hexagonal):
  - `cmd/worker` (dispatcher): polls `jobs`, enqueues `whatsmeow_jobs`
    (link = `source_job_serial`).
  - `cmd/whatsapp_worker` (executor): runs sends, writes terminal status/result
    (wamid) back to `jobs`; handles inbound WhatsApp events via
    `handlers/whatsapp/handler.go` → `service.Message.Inbound` → builds WABA
    payload → forwards to customer webhook URL with retry/backoff
    (`service/message.go`, `adapters/webhook/client.go`).

Key facts:

1. The inbound path has zero DB writes today. `MessageService.Inbound` only
   reads webhook config over HTTP (`GET /api/internal/v1/webhook-config`,
   `INTERNAL_TOKEN`-authed) and forwards. The outbound path writes the DB
   (jobs/whatsmeow_jobs via pgx).
2. No `/api/v1/messages` route exists yet (ROADMAP Phase 3: engine works,
   public route not wired; `SendMessageService` is composed but no route calls
   it). API-request observability must capture all `/api/v1/*` traffic
   generically and be ready for send-message.
3. No request logging, no middleware, no event bus, no audit tables. Existing
   "observability" is `log.Printf` in the worker and `console.error` alarms in
   the dashboard.
4. Schema conventions are strong and consistent (from `shared/AGENTS.md` + 12
   migrations): `bigint id` + `uuid serial` (public key), `created_at`/
   `updated_at` timestamptz + `set_updated_at()` trigger, `text` + CHECK
   statuses (never `pgEnum`), `jsonb` for free-form payload/result,
   `deleted_at` soft delete, partial unique indexes, no FKs on uuid links
   (`source_job_serial` pattern), next migration **000013** (do not fill the
   000006 gap).
5. UI patterns are consistent: client pages + `src/lib/hooks/use*` (plain
   state/effects, no data library) + `src/lib/api/client.ts` typed fetch +
   table components (`Table/TableRow/TableCell/Badge/EmptyState/Mono`), sidebar
   groups in `src/app/(app)/layout.tsx`. "Monitor" group already exists with
   placeholder Jobs/Settings links. No lucide-react — hand-ported SVGs in
   `src/components/icons/index.tsx`. No resource detail pages exist (sessions
   are cards, webhooks use modals).
6. Known schema.ts drift: stale `.unique()` on
   `sessions`/`webhookConfigs.phone_number_id`, missing DESC index order, dead
   `whatsmeowJobs` import in the dashboard transport.

## 1. What needs to be added or changed

| # | Change | Where |
|---|--------|-------|
| A | Migration `000013_create_activity_events` (+down) | `shared/db/migrations/` |
| B | Drizzle mirror `activityEvents` + `$inferSelect`/`$inferInsert` | `shared/db/schema.ts` |
| C | Activity transport + service (list/filter/detail, record) | `apps/dashboard/src/lib/api/ports/`, `service/`, `adapters/db/index.ts`, `domain/`, `compose.ts` |
| D | API-request capture wrapper applied to public routes | `apps/dashboard/src/app/api/v1/**/route.ts` |
| E | Management routes `GET /api/v1/observability` + `/[serial]` | `apps/dashboard/src/app/api/v1/observability/` |
| F | Worker recorder port + pgx adapter | `services/worker/internal/core/ports/activity_recorder.go`, `internal/adapters/activity/` |
| G | Capture points in worker (events + delivery attempts) | `handlers/whatsapp/handler.go`, `service/message.go`, `service/whatsapp_executor.go` |
| H | UI: nav item, list page, detail page, hooks, client fns, icon | `src/app/(app)/observability/`, `src/lib/hooks/`, `src/lib/api/`, `src/components/icons/` |
| I | Docs updates (repo convention requires it) | `docs/shared/README.md`, `docs/flow.md`, `shared/AGENTS.md` table, service docs |
| J | (Optional, recommended first) fix schema.ts drift + dead import | `shared/db/schema.ts`, `apps/dashboard/src/lib/api/adapters/db/index.ts` |

## 2. Where changes live (concrete)

- **Dashboard backend:** `src/lib/api/ports/activity-transport.ts`,
  `src/lib/api/service/observability.ts`, `src/lib/api/domain/observability.ts`,
  extend `DrizzleTransport` in `src/lib/api/adapters/db/index.ts`, wire in
  `src/lib/api/compose.ts`, add `src/lib/api/observability.ts` (client fns) +
  `src/lib/api/types.ts` additions.
- **Dashboard routes:** `src/app/api/v1/observability/route.ts` (GET list) and
  `src/app/api/v1/observability/[serial]/route.ts` (GET detail). Capture
  wrapper lives in `src/lib/api/observability-capture.ts` (or
  `src/lib/api/with-activity.ts`).
- **Worker:** `internal/core/ports/activity_recorder.go`,
  `internal/adapters/activity/store.go` (pgx, table name fixed at construction,
  matching `queue.NewStore` style), inject into `service.NewMessage(...)` and
  `service.NewWhatsAppExecutor(...)`; wire in `cmd/whatsapp_worker/main.go`.
- **UI:** `src/app/(app)/observability/page.tsx`,
  `src/app/(app)/observability/[serial]/page.tsx`,
  `src/lib/hooks/useObservability.ts`, nav item in `src/app/(app)/layout.tsx`,
  new `IconActivity` in `src/components/icons/index.tsx`.

## 3. Data representation and persistence

**Recommendation: one generic `activity_events` table** with a type
discriminator + `jsonb` detail, not per-kind tables. Rationale: matches the
codebase `jsonb` payload conventions (`jobs.payload`, `jobs.result`), gives a
uniform Stripe-like timeline with one list/one detail page, and avoids a
join-table explosion.

```sql
-- 000013_create_activity_events.up.sql
create table if not exists activity_events (
  id                bigint generated always as identity primary key,
  serial            uuid not null default gen_random_uuid(),
  type              text not null check (type in ('api_request','whatsapp_event','webhook_delivery')),
  status            text not null check (status in ('ok','error','attempted')),
  phone_number_id   text,                       -- tenant/device key (existing convention, no FK)
  business_account_id text not null default '', -- parity with sessions
  summary           text not null default '',   -- short human line for list rows
  -- correlation columns (all nullable; uuid links follow the no-FK source_job_serial pattern)
  job_serial            uuid,                   -- API request → jobs/whatsmeow_jobs
  wa_message_id         text,                   -- wamid: outbound result ↔ inbound event
  source_activity_serial uuid,                  -- webhook_delivery → whatsapp_event
  resource_type         text,                   -- 'session' | 'webhook_config' | 'api_key' | 'job'
  resource_serial       uuid,                   -- serial of the related resource when it exists
  request_serial        uuid,                   -- api_key serial / 'bootstrap' tag / null
  payload           jsonb,                      -- kind-specific detail (see §4)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists activity_events_list_idx on activity_events (created_at desc, type);
create index if not exists activity_events_phone_idx on activity_events (phone_number_id);
create index if not exists activity_events_job_serial_idx on activity_events (job_serial) where job_serial is not null;
create index if not exists activity_events_wamid_idx on activity_events (wa_message_id) where wa_message_id is not null;
create index if not exists activity_events_source_idx on activity_events (source_activity_serial) where source_activity_serial is not null;
create trigger activity_events_set_updated_at before update on activity_events
  for each row execute function set_updated_at();
```

No `deleted_at` (append-only log; pruning handled separately if ever needed).
schema.ts mirror follows existing conventions (`bigint id
generatedAlwaysAsIdentity`, `uuid defaultRandom`, `timestamp withTimezone`,
`.$type<>()` unions, partial indexes with `.where(sql...)`).

Payload shapes per type (redacted):

- `api_request`: `{ method, path, status, duration_ms, error }` (+ `job_serial`
  when the request enqueued a job). Never store raw request/response bodies or
  secrets; store the auth source (`resource_serial` = api key serial, or
  `"bootstrap"`).
- `whatsapp_event`: `{ message_id, message_type, from, from_me, profile_name,
  context_message_id, payload_summary }` — compact summary of the WABA payload.
- `webhook_delivery`: `{ webhook_config_serial, url, event, attempts,
  attempt_statuses: [{attempt, status_code|error, duration_ms, hmac}],
  final_outcome }`.

## 4. Where events are captured

**API requests (dashboard):** a small wrapper — `withApiActivity(handler,
options)` — applied to each `/api/v1/*` route handler. It wraps the existing
`authorizeApi` + handler call, captures `method/path/status/duration_ms`, the
authenticated identity (`authorizeApi` can return the key serial or
`"bootstrap"`), any `job_serial` the handler reports (optional return), and
records fire-and-forget through the activity transport. A wrapper beats
middleware: it runs in the Node runtime, sees the final `NextResponse`, knows
the auth identity, and covers exactly the public API surface (~16 route files).
Routes that create jobs (`sessions/[serial]/pairing`, `logout`) pass their
enqueued serial into the wrapper.

**WhatsApp events (worker):** single choke point — `handlers/whatsapp/handler.go`
(every inbound event enters here; it already logs each one). Record through a
new `ports.ActivityRecorder` after the event is translated to
`entity.InboundEvent` (so we capture the WABA-visible fields, not raw whatsmeow
types). Fire-and-forget: a recorder failure must never break the forward path
(log + continue, same policy as heartbeat / `last_used_at`).

**Webhook deliveries (worker):** `service/message.go` — inside `Inbound`,
record one activity row per delivery attempt in the `forwardWebhookWithRetry`
loop (attempt number, outcome, latency) and a terminal `webhook_delivery` row
(delivered / failed after `webhookForwardAttempts`). This lives in the service
because the retry orchestration is there; the recorder is a new injected port
on `Message`, keeping the hexagonal layering intact. The delivery row carries
`source_activity_serial` = the serial returned by the event row recorded
moments earlier.

**Outbound sends (worker):** record in `whatsapp_executor.go` (send outcome,
wamid) — makes the future `POST /messages` flow visible even before its route
exists. Carries `job_serial`.

## 5. Connecting related events

Explicit correlation columns (above) + a "related" query on the detail
endpoint:

- **API request → job → outbound send:** request row carries `job_serial`;
  executor row carries the same `job_serial` (from `source_job_serial`), so one
  lookup joins the full request → queue → send chain.
- **Outbound send ↔ WhatsApp event:** both carry `wa_message_id` (executor
  writes `result.wa_message_id`; inbound events carry their wamid). Query
  `wa_message_id = $wamid`. Yields the conceptual chain
  `API Request ↓ Nexus/Message ↓ WhatsApp Event ↓ Webhook` — the send's later
  status/receipt events link back automatically.
- **WhatsApp event → webhook delivery:** direct link via
  `source_activity_serial` (event row's serial).
- **Resource links:** `resource_type` + `resource_serial` → session / webhook
  config / api key rows; detail page links to those resources.

The detail endpoint returns `{ activity, related: [...] }` where `related` =
rows matched on any shared correlation column, plus the two sides of the chain
(`source_activity_serial` and anything pointing at this row).

## 6. List and detail UI

Follow the existing `(app)` client-page pattern exactly (webhooks/api-keys
pages are the templates; designer owns implementation):

- **Nav:** add "Activity" under the existing **Monitor** group in
  `src/app/(app)/layout.tsx` with a hand-ported `IconActivity` (no lucide-react).
- **List — `/observability`:** client page + `useObservability` hook (plain
  state/effects, `refresh`, like `useSessions`). Header + type tabs
  ("All / API Requests / WhatsApp Events / Webhook Deliveries") + status/phone
  filters + Table with columns: Type (Badge), Summary, Phone (Mono), Status
  (Badge: ok/error/attempted), Time. Loading skeleton and `EmptyState` exactly
  like the webhooks page. Rows link to the detail page. Auto-refresh toggle is
  a nice-to-have.
- **Detail — `/observability/[serial]`:** client page fetching
  `{ activity, related }`. Header (type badge, status, timestamp), key-value
  property list (phone, wamid, job, resource, duration, status code), a Mono
  JSON block of `payload`, and a **Related activity** section rendering the
  linked rows as clickable mini-rows (same table components). Resource links
  navigate to `/sessions`, `/webhooks`, `/api-keys` (no per-resource detail
  pages exist yet — see tradeoffs).
- **Copy:** designer produces the visual/interaction work; orchestrator reviews
  copy afterwards without changing the design.

## 7. Tests

- **Worker unit/functional** (existing `*_test.go` conventions, ports mocked):
  - `Message.Inbound` records an event row and a delivery row (attempts incl.
    failure/backoff path) when a recorder is injected; recorder failure does
    not fail the forward.
  - `WhatsAppExecutor` records send outcome with wamid + job serial.
  - Recorder-store query builder (if any pure mapping is extracted).
- **Dashboard unit** (existing `*.test.ts` beside service files):
  - `ObservabilityService` list filtering (by type/status/phone), detail +
    related resolution, mapping to wire shape.
  - Transport: insert + indexed queries.
- **Route tests** (following `route-auth.test.ts` + `api-keys.test.ts`
  patterns): bootstrap-only auth on `/api/v1/observability` (persisted keys
  never authorize), list/detail envelopes, 404 on unknown serial, error shapes.
- **Docs/consistency:** update `docs/shared/README.md` table,
  `shared/AGENTS.md` table, `docs/flow.md` (add observability to flows 5/6),
  service docs.

## 8. Recommended implementation order

1. **Housekeeping:** fix schema.ts drift + dead `whatsmeowJobs` import (small;
   prevents layering on stale definitions).
2. **Migration 000013 + schema.ts `activityEvents`** (+ `docker compose build
   migrate && docker compose up -d migrate postgres`, per shared/AGENTS.md).
3. **Dashboard transport + service + routes** (record + list + detail), with
   `withApiActivity` on existing routes. Verify with unit + route tests.
4. **Worker recorder port + adapter + capture points** (events, deliveries,
   sends). Verify with functional tests.
5. **UI** (designer): icon, nav, list page, detail page, hooks, client fns.
6. **Docs updates** (AGENTS.md convention: every plan that changes code
   includes a docs step).
7. Optional follow-ups: retention/pruning, auto-refresh, per-attempt rich
   status from the forwarder.

## 9. Tradeoffs and open questions

1. **Single table vs typed tables.** Recommended single `activity_events` +
   `jsonb`. Typed tables would match Stripe more literally but triple the
   schema/UI/query surface for no current need.
2. **Worker writes DB directly vs via a new internal API.** Recommended direct
   pgx write through a new `ActivityStore` (worker already owns a pool;
   fire-and-forget with log-on-error so observability never affects the forward
   path). Alternative — `POST /api/internal/v1/activity` — matches the
   webhook-config/heartbeat pattern but adds an HTTP dependency to the hot
   inbound path. **Open decision — confirm before implementation.**
3. **API-request capture = explicit wrapper, not middleware.** Predictable,
   Node-runtime, sees auth identity + final status. Costs a touch of boilerplate
   per route (~16 routes); middleware can't see the response status easily and
   runs in the edge runtime.
4. **No `POST /messages` route yet.** API-request observability captures
   everything generically and the send flow becomes fully traceable the moment
   Phase 3 lands (all capture points + correlations already exist). **Open
   decision — ship observability before or with the messaging route.**
5. **Payload redaction.** Storing full request/response bodies would help
   debugging but risks persisting webhook secrets and message content. Plan
   stores summaries only. Confirm acceptable, or specify what should be stored.
6. **Per-attempt webhook detail.** Recording attempt status codes requires
   `ports.WebhookForwarder.Forward` to return richer detail than `error` (e.g.,
   `(statusCode int, err error)`). Either change the port (small, existing tests
   updated) or record per-attempt rows without status codes.
7. **Correlation to receipts/statuses.** The worker currently only handles
   `events.Message`; delivery-status receipts aren't handled yet. Outbound
   send → receipt linking will appear automatically once that exists (wamid
   column is already there).
8. **Retention.** Append-only table grows unboundedly; no scheduler exists.
   Options: prune-on-list (delete older than N days), worker ticker, or defer.
   Recommend a simple prune-on-list initially or defer entirely.
9. **Auth model for the observability API.** Recommended bootstrap-only (like
   `/api/v1/api-keys` management) — persisted keys never read it. **Open
   decision — confirm.**
10. **Resource navigation depth.** No session/webhook detail pages exist;
    cross-links land on filtered list pages. Building observability first
    creates natural demand for resource detail pages later.

## 10. Review amendments (oracle review + user decisions, 2026-08-14)

Code-verified corrections and decisions, reconciled before execution. These
amend the sections above:

- **R1 (§4/§9.3):** `authorizeApi` does NOT return identity — it returns
  `Promise<boolean>` and has ~57 call sites; do NOT change its signature. Add
  a sibling `authorizeApiWithIdentity(req, token, options): Promise<{ authorized:
  boolean; identity: string | null }>` where `identity` ∈ `{<apiKeySerial>,
  "bootstrap", null}`; only wrapper-adopting routes use it. Resolve in T3.
- **R2 (§3):** `request_serial` must be `text`, not `uuid` — it stores an
  api_key serial OR the literal `"bootstrap"`.
- **R3 (§4 worker):** generate activity uuids in app code (not DB default) so
  `source_activity_serial` is knowable without awaiting the write; record
  fire-and-forget in a goroutine with `context.WithoutCancel` (device disconnect
  must not drop the write); inside `forwardWebhookWithRetry` the recorder call
  must never mutate the forward `lastErr` (a recorder error must not trigger
  webhook retry/backoff).
- **R4 (§4 dashboard):** record fire-and-forget mirroring `touchLastUsedBestEffort`
  (server-auth.ts): build the `NextResponse` first, then
  `void service.record(...).catch(log)` — never await, always catch.
- **R5 (§7):** add dashboard route test: activity transport throws but the API
  still returns its normal envelope (dashboard-side "recorder failure doesn't
  break the request").
- **R6 (§3):** add partial index
  `activity_events (resource_serial) where resource_serial is not null` — the
  detail-page `related` query matches on `resource_serial`.
- **R7 — decisions (user-confirmed):** §9.2 direct pgx `ActivityStore`;
  §9.9 bootstrap-only auth; §9.5 **full request/response detail** (overrides
  "summaries only" — store full bodies, but never Authorization/API-key
  headers); §9.4 messages route EXISTS (`POST /api/waba/v26.0/{phone_number_id}/messages`,
  commit 5bc171e) → capture wrapper scope = `/api/v1/*` **plus** the waba
  messages route.
- **O3:** `src/lib/api/observability.ts` client fns are an explicit T6 deliverable
  (unblocks the designer's `useObservability` hook in T8).
- **O4:** during T2 verification, confirm the new migration down-then-up applies
  cleanly (shared/AGENTS.md).
