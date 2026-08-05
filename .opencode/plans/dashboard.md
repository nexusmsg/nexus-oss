# Dashboard: Nexus Developer Portal (`apps/dashboard`)

## Objective

Build the production UI for the Nexus developer portal from the exported
design in `design/dashboard/` (DESIGN-HANDOFF.md is the visual contract).
Scope for this milestone (M1) is limited to the shell plus the three mandatory
pages — API Keys, Sessions, Webhooks. All other design screens (auth, register,
jobs, settings, overview/launcher) are explicitly out of scope and must not be
implemented in M1.

The dashboard is a browser SPA that consumes the existing Hono API
(`services/api`, port 3000) over HTTP. M1 also includes two small, bounded API
changes: accept Basic Auth in addition to Bearer, and add CORS for direct
cross-origin browser calls (see Authentication and CORS sections).

## Confirmed Decisions

| # | Decision |
| - | -------- |
| 1 | **Stack: React + Vite + TypeScript** (chosen by user; `apps/` had no convention). One app per subdirectory per `apps/AGENTS.md`. |
| 2 | **Screen-file-first** per DESIGN-HANDOFF: each design screen becomes its own route. Root `/` redirects to `/sessions`. |
| 3 | **API Keys: frontend first.** Build the page per design with empty/disabled state and define the API contract. Backend (migration + endpoints) is a separate milestone (M2+), tracked below so it is not lost. |
| 4 | **FE→BE connectivity: direct cross-origin with CORS on the API** (no Vite proxy — user decision). The BE adds Hono CORS middleware with env-configurable allowed origins (`CORS_ORIGINS`, default `http://localhost:5173` — the Vite dev origin). The FE calls the API origin directly via `VITE_API_URL`. CORS is in M1 scope. |
| 5 | **Design fidelity:** tokens extracted from the exported `:root` CSS into a shared token sheet; component structure ported from the HTML exports, not reinterpreted. Dark theme, accent `#34d399`, Inter + JetBrains Mono, sidebar 240px / topbar 56px, collapse at 768px. |
| 6 | **Device-card action rows stay intact (fidelity).** The design renders Disconnect\|Logout\|Delete / Show QR\|Cancel / Reconnect\|Delete per status. M1 renders the full row; actions without a backing endpoint (Delete, Disconnect) render **disabled with a tooltip** ("requires backend B2"), preserving card geometry and affordances. Reconnect maps to re-running pairing (`startPairing`), not a new endpoint. |
| 7 | **Sessions create-form mapping.** The design "Add New Device" modal collects Phone Number + Device Label; the API requires `phone_number_id` (Meta-assigned, not derivable) + `number`. M1 adds a `phone_number_id` input to the modal (real product data — approved design deviation) and drops the Device Label field (no API column; `number`/`business_account_id` cover identification). The modal is two-stage: form → QR after "Start Pairing", matching the API's create → pairing job → poll QR flow. |
| 8 | **Toolchain pinned:** ESLint flat config + `eslint-plugin-react-hooks` + `eslint-plugin-react-refresh`; vitest + `@testing-library/react` for app tests. (No workspace has lint tooling today; this app introduces it without touching other packages.) |
| 9 | **Authentication scope (Nexus OSS)**: see the Authentication section below. Default = env API key (Bearer) for FE→BE; additionally supported = Basic Auth from the browser. Both schemes authenticate against the same shared secret `API_AUTH_TOKEN` (BE change, in M1). Full login/session screen (auth.html) stays out of scope (B5). |

## Repo Layout (target)

```text
apps/
  dashboard/                  # new workspace @waba/dashboard (React + Vite + TS)
    .env.example              # VITE_API_TOKEN= (unset → Basic Auth mode); VITE_API_URL=http://localhost:3000
    src/
      app/                    # router + layout (shell: sidebar + topbar)
      routes/
        sessions/             # /sessions
        webhooks/             # /webhooks
        api-keys/             # /api-keys
      api/                    # typed client (fetch) + endpoint modules
      styles/                 # design tokens (extracted from design/dashboard HTML)
      components/             # shared shell + UI components
    package.json              # workspace @waba/dashboard, turbo tasks build/dev/test/lint
    vite.config.ts            # base config only (no proxy; direct CORS calls)
    index.html
docs/
  apps/
    README.md                 # app index (per apps/AGENTS.md) — NEW in M1
```

- Root scripts (`npm run dev/build/test/lint`) must keep working; the new app
  participates in the existing turbo pipeline (`turbo.json` tasks already
  generic: build/dev/test/lint).
- `docs/README.md` rows that still label `apps/` as placeholder are updated in
  M1 to point at `docs/apps/`.
- `HANDOFF.md` updated as M1 lands.

## API Readiness (verified vs design pages)

### Sessions — READY (full coverage)

Endpoints (`services/api/src/adapters/http/app.ts`):

- `POST /api/v1/sessions` — create, idempotent per `phone_number_id`
  (requires `phone_number_id` + `number`; `display_phone?`, `business_account_id?`)
- `GET /api/v1/sessions` → `{ sessions: [...] }` / `GET /api/v1/sessions/:serial`
- `POST /api/v1/sessions/:serial/pairing` → `202 { job_serial }`
- `GET /api/v1/sessions/:serial/pairing/qr` → `{ status, qr_code }`
- `POST /api/v1/sessions/:serial/logout`
- `GET /api/v1/sessions/:serial/status` — statuses: `created/pairing/connected/disconnected/logged_out`

Session shape: `id` (=serial), `phone_number_id`, `number`, `display_phone`,
`business_account_id`, `status`, `whatsapp_id`, `connected_at`,
`last_seen_at`, `logged_out_at`, `created_at`.

Design mapping notes:

- Status badges: `connected` → success, `pairing` → warning,
  `disconnected`/`logged_out` → danger, `created` → neutral.
- "Display name" field in design has no API field; show `number` +
  `business_account_id` instead.
- Device-card error state (design) renders for `disconnected`/`logged_out` with
  generic copy, e.g. "Connection lost — device is disconnected. Reconnect to
  restore it." (the API has no error-message field).
- QR flow states (`qr_code` can be `null`): `pending` → "Waiting for QR",
  `ready` → render (add a `qrcode`-type renderer dependency), `expired`/
  `not_found` → show retry action. Full pairing reaches only `pending` without
  the worker + a live WhatsApp device; that is the expected M1 smoke ceiling.

### Webhooks — READY (CRUD), gaps on auxiliary data

Endpoints:

- `POST /api/v1/webhooks` — create accepts **only** `phone_number_id`,
  `webhook_url`, `webhook_secret?`. Retry/timeout/enabled fields are accepted
  only on PATCH (silently ignored on POST) — the add-modal must not expose them,
  or must follow up with a PATCH.
- `GET /api/v1/webhooks` → `{ webhooks: [...] }` / `GET /api/v1/webhooks/:serial`
- `PATCH /api/v1/webhooks/:serial` — `webhook_url?`, `webhook_secret?`,
  `enabled?`, `max_retries?`, `retry_delay_ms?`, `timeout_ms?`
- `DELETE /api/v1/webhooks/:serial` (soft delete)
- `GET /api/v1/webhooks/:serial/subscriptions` → `{ subscriptions: [...] }`
  (default `["messages"]`)
- `POST /api/v1/webhooks/:serial/subscriptions` /
  `DELETE /api/v1/webhooks/:serial/subscriptions/:eventType`

Config shape: `id`, `serial`, `phone_number_id`, `webhook_url`,
`webhook_secret` (may be `null`), `enabled`, `max_retries`, `retry_delay_ms`,
`timeout_ms`, `created_at`.

All failures across the API return the WABA error envelope
`{ error: { code, details } }` with HTTP status (validation errors use
`code: 100`); the typed client must normalize this envelope.

Design mapping notes:

- `enabled` → active/paused badge; `webhook_secret` set/empty → secret badge.
- Add/Edit modal phone selector populates from `GET /api/v1/sessions`.
- **Delivery Log table has no data source** (delivery is executed by the Go
  worker; no log endpoint exists). M1: render the card with empty state.
- **"Verify Token" field has no backend concept** (no `hub.challenge`
  verification endpoint exists). M1: omit the field; tracked as backend B4.
- **Test button per row**: no endpoint exists. M1 renders it disabled with a
  tooltip; tracked as backend B6.

### API Keys — NOT READY (no backend at all)

No endpoints, no DB table (migrations 000001–000005 cover jobs, webhook
configs/subscriptions, sessions, session_qr_codes only). Auth today is the
static `API_AUTH_TOKEN` env var.

M1: implement the page per design (table, generate/reveal/revoke modals,
alert) against an empty state; generate flow disabled with a clear "API keys
backend coming" note. Define the contract:

- `GET /api/v1/api-keys` → list (name, scope, created_at, last_used_at, status)
- `POST /api/v1/api-keys` → create (name, scope, expiry) → return plaintext key once
- `DELETE /api/v1/api-keys/:serial` → revoke
- `PATCH /api/v1/api-keys/:serial` → rename

### Cross-cutting gaps

- **CORS was missing on the API** — now in M1 scope (user decision): Hono CORS
  middleware with env-configurable origins, allowing the `Authorization` +
  `Content-Type` headers and the methods the dashboard uses. See CORS section.
- **Auth was bearer-only** — the API's `auth.ts` accepted only
  `Authorization: Bearer`. Basic Auth support is now in M1 scope (see the
  Authentication section). A full login/session screen (auth.html) stays out
  of M1 scope (B5).
- **Nav items without routes** (Dashboard/Jobs/Settings in the design shell):
  render disabled with a "coming soon" treatment (keeps layout, no dead
  routes). The API Keys nav badge (`3` in the design) is suppressed while the
  page is in empty state.

## Authentication (Nexus OSS)

Scope decision: the dashboard authenticates FE→BE with either

1. **Env API key (default)** — `VITE_API_TOKEN` set at build/run time; the
   typed client sends `Authorization: Bearer <token>` on every request. Maps
   to the API's `API_AUTH_TOKEN` shared secret.
2. **Basic Auth from the browser** — when no env token is configured (or on a
   401), the dashboard prompts for credentials in the browser and sends
   `Authorization: Basic base64(user:pass)`. Credentials are cached in
   sessionStorage for the tab session, with a clear/retry affordance on 401.

**BE change (in M1, small and well-bounded):** extend
`services/api/src/adapters/http/auth.ts` to accept **either** scheme against
the same `API_AUTH_TOKEN` secret:

- `Authorization: Bearer <API_AUTH_TOKEN>` (unchanged), or
- `Authorization: Basic base64(user:pass)` where the **password equals
  `API_AUTH_TOKEN`** (username free-form, e.g. `nexus`). *Assumption — swap to
  dedicated `BASIC_AUTH_USER`/`BASIC_AUTH_PASSWORD` env vars if preferred.*

Behavior:

- Empty `API_AUTH_TOKEN` keeps auth disabled for both schemes (current dev
  default).
- 401 responses include `WWW-Authenticate: Basic realm="nexus"` so
  browser-native Basic Auth (and reverse proxies in front) can drive the
  prompt.
- Bearer takes precedence when both headers are present.

**FE auth resolution:** env token set → Bearer; otherwise → Basic Auth gate
(minimal centered credential form — not the full auth.html screen). All calls
to the API origin share one resolved Authorization header; the base URL comes
from `VITE_API_URL` (direct cross-origin, no proxy — see CORS section).
Verification of the API key happens at the BE; the FE never mints or stores
keys beyond the env value.

## CORS (direct FE→BE calls)

User decision: **no Vite dev proxy**; the dashboard calls the API directly,
cross-origin. The BE must answer CORS.

- **BE:** `hono/cors` middleware (ships with Hono, no new dependency) applied
  to the `/api/v1/*` surface. Configured from a new env var `CORS_ORIGINS`
  (comma-separated allow-list; default `http://localhost:5173` — the Vite dev
  origin; empty → CORS off, API-only use).
- Allow: methods `GET/POST/PATCH/DELETE/OPTIONS`; headers `Authorization`,
  `Content-Type`; no `credentials` (Basic is sent as a header, not cookies —
  cookie sessions would revisit this in B5).
- 401 + `WWW-Authenticate: Basic` still works cross-origin (it is a header,
  not a cookie).
- **FE:** base URL from `VITE_API_URL` (default `http://localhost:3000`); all
  `/api/v1/*` requests go there directly.

## Milestones

### M1 — Dashboard shell + 3 mandatory pages + auth gate + CORS (Completed 2026-08-05)

Verification evidence: root `npm run build` 3/3 packages OK; `npm run lint`
2/2 OK; `npm test` 3/3 OK — api 171 passed + 34 skipped (integration gated on
`TEST_SUPABASE_URL`), dashboard 8 passed (API client + auth-context), worker
go tests green. BE auth/CORS + FE app implemented per the sections above;
docs updated (`docs/apps/README.md`, `docs/README.md`, `HANDOFF.md`,
`docs/services/api/configuration.md`).

Live-stack verification (replaces the manual curl smoke): the API integration
suite (`app.integration.test.ts`) now covers the M1 auth + CORS behavior —
Bearer/Basic valid, wrong password, malformed Basic, missing header → 401 with
`WWW-Authenticate: Basic realm="nexus"`; CORS preflight allowed origin
(204 + allow-origin/methods/headers), disallowed origin (no allow-origin),
`corsOrigins: []` → off, real GET carries allow-origin. 34 tests pass against
the real PostgREST + Postgres stack (run command + dev JWT in `HANDOFF.md`).

Browser viewport matrix (360–1920): **dropped by user decision 2026-08-05** —
a Playwright E2E attempt was cancelled and fully cleaned up; FE behavior
verification stays with vitest unit tests (auth resolution + gate flow). Note
for a future E2E: the dashboard app's UI is design-fidelity-sensitive; the
viewport check would be the one gap a later Playwright/visual lane should close.

- **API change (services/api, bounded):** extend `adapters/http/auth.ts` to
  accept Bearer or Basic against `API_AUTH_TOKEN` (per Authentication section);
  `WWW-Authenticate: Basic` on 401. Verify with `npm test` (new cases) +
  `tsc --noEmit` + `build` in `services/api`.
- **API change (services/api, bounded):** add Hono CORS middleware on
  `/api/v1/*` per the CORS section (`CORS_ORIGINS`, default
  `http://localhost:5173`); verify with `npm test` (preflight + origin
  allow-list cases) + `tsc --noEmit` + `build`.
- Scaffold `apps/dashboard` (@waba/dashboard, React + Vite + TS) with turbo
  tasks, lint (ESLint flat config + react-hooks + react-refresh) and test
  (vitest + @testing-library/react) wiring, `.env.example` (`VITE_API_URL`,
  `VITE_API_TOKEN`).
- Extract design tokens from `design/dashboard/*.html` into a shared token sheet.
- **FE auth client + gate:** resolve Bearer from `VITE_API_TOKEN` or prompt
  for Basic credentials on 401 (sessionStorage cache, clear/retry affordance);
  one shared Authorization header for all calls to the API origin.
- Build shell (sidebar + topbar + mobile toggle) ported from `dashboard.html`;
  out-of-scope nav items disabled ("coming soon").
- `/sessions`: device grid, two-stage Add Device modal (form with
  `phone_number_id` + `number` → start pairing → poll QR per status), status
  polling, logout. Full action rows rendered with disabled actions per
  Decision 6.
- `/webhooks`: config CRUD table + add/edit modal (phone from sessions list,
  URL, secret; PATCH-only fields behind edit, not create) + subscriptions;
  delivery log empty state; Test button disabled per design.
- `/api-keys`: page per design with empty state, contract defined (see above).
- `docs/apps/README.md` (NEW), `docs/README.md` apps rows, `HANDOFF.md` update.
- Verification: `npm run build`, `npm run lint`, `npm test` (new app test),
  plus visual check vs the DESIGN-HANDOFF viewport matrix (360–1920) with no
  horizontal overflow.

### M2+ — Backend follow-ups (tracked, NOT in M1)

| # | Item | Where |
| - | ---- | ----- |
| B1 | **API keys**: migration + CRUD endpoints (scope/expiry/last-used, plaintext-once) | `shared/db/migrations` + `services/api` |
| B2 | **Session delete + disconnect**: decide whether Disconnect = logout or a new endpoint; add DELETE session (design Delete action) | `services/api` |
| B3 | **Webhook delivery log** read endpoint (worker-side delivery data) | `services/api` (+ worker data source) |
| B4 | **Webhook verification** (`hub.challenge`) + verify-token concept | `services/api` |
| B5 | **Full auth/login screen** (auth.html design) + session for the dashboard; M1 already covers the Bearer/Basic gate (and cookie-session CORS implications) | `services/api` + `apps/dashboard` |
| B6 | **Webhook test-delivery** endpoint (Test button) | `services/api` |
| B7 | **Launcher/overview route** (`index.html` portal launcher) | `apps/dashboard` |

> Note: CORS was previously tracked as B5; it moved into M1 (see CORS
> section). B-numbers shifted down accordingly.

M2+ follows the repo rules: migration in golang-migrate format, API changes
verified with `npm test` + `tsc --noEmit` + `build`, integration gated on
`TEST_SUPABASE_URL`, and `docker compose build migrate` before `up -d` after
new migrations. Docs under `docs/services/api/*` updated in the same milestone.

## Verification (M1)

- `npm run build` and `npm run lint` at repo root pass (turbo across all
  workspaces).
- New app `test` task runs (vitest) — at minimum API client unit tests,
  including auth resolution: env token → Bearer header; no env token → Basic
  flow; 401 → prompt + retry.
- API auth tests (`services/api`): Bearer valid → pass; Basic valid (password
  = `API_AUTH_TOKEN`) → pass; invalid either scheme → 401 with
  `WWW-Authenticate: Basic realm="nexus"`; empty secret → auth disabled for
  both schemes.
- CORS tests (`services/api`): OPTIONS preflight from an allowed origin → CORS
  headers present; disallowed origin → no CORS headers; `CORS_ORIGINS` empty →
  CORS off. FE smoke: dashboard served from the Vite origin calls
  `VITE_API_URL` cross-origin with the Authorization header intact.
- Visual check: compare rendered routes against design HTML at the handoff
  viewport matrix; no horizontal overflow on mobile.
- API smoke (preconditions: `docker compose up -d postgres postgrest api` with
  migrations applied per `HANDOFF.md`; `API_AUTH_TOKEN` may be empty in dev,
  i.e. auth off): sessions flow scoped to **create → list → status → logout**;
  QR flow verified only to `pending` (full pairing needs the worker + a live
  WhatsApp device — deferred to a device-backed environment). Webhooks flow:
  create → list → patch → delete.

## Docs Sync

- NEW `docs/apps/README.md` (index for the apps area, per `apps/AGENTS.md`).
- Update `docs/README.md` (apps rows still labeled placeholder) and
  `HANDOFF.md` (what landed, verification evidence, open items).
- `docs/services/api/configuration.md`: new `CORS_ORIGINS` env row; auth notes
  (Bearer + Basic behavior) updated in M1, per the root AGENTS.md docs rule.
- If routes/config change in later milestones: `docs/services/api/*` per root
  AGENTS.md docs rule.

## Review Status

- 2026-08-05 — Oracle review (approve-with-changes). Issues 1–14 reconciled:
  corrected POST /webhooks contract, documented response envelopes + error
  envelope + QR statuses, decided create-form mapping (phone_number_id input,
  two-stage modal, Device Label dropped), pinned toolchain, conditional token
  header, disabled-but-visible action rows + Test button, nav "coming soon"
  treatment, docs index rows, smoke-test preconditions, B-list expanded (B6,
  B7, B2 covers disconnect, reconnect = re-run pairing).
- 2026-08-05 — Auth scope added (user decision): FE authenticates FE→BE by
  default via env API key (`VITE_API_TOKEN` → Bearer) and additionally supports
  Basic Auth from the browser (password = `API_AUTH_TOKEN`; 401 +
  `WWW-Authenticate: Basic`). BE accepts both schemes (M1, bounded change to
  `auth.ts`); full auth.html login screen stays as B5.
- 2026-08-05 — Connectivity changed (user decision): Vite dev proxy dropped;
  FE calls the API directly cross-origin. BE CORS middleware (`CORS_ORIGINS`,
  default `http://localhost:5173`) moves from the B-list into M1; FE base URL
  via `VITE_API_URL`. B-list renumbered (CORS was B5).
