# Sessions Page (`/sessions`) — Nexus Dashboard (Next.js 16)

## Context

2026-08-10. Implement the Sessions screen from `design/dashboard/sessions.html`
(+ `DESIGN-HANDOFF.md`) into `apps/dashboard/` with proper Next.js App Router
patterns. The design system is committed (`f2d027c`, `refactor(apps)` adds
explicit sidebar nav groups). Today's UI scope is **sessions** (webhooks
follows next); the sessions backend is **fully implemented** — nothing to stub.

This plan is the current source of truth for the sessions milestone. It includes
the user-confirmed five flows (below) and the minimal routing-shell + API-client
prerequisites so `/sessions` lands green end-to-end.

Backend source of truth (recon `ses_013d41c8affeQSe9rYcP3nycm7`):
`services/api/src/adapters/http/app.ts` + `services/api/src/service/session.ts`
+ worker `whatsapp_executor.go` / `whatsmeow/client.go`.

## API contract (confirmed implemented)

Auth: `Authorization: Bearer <API_AUTH_TOKEN>` or `Basic base64(user:token)`;
empty token disables auth. Errors: WABA envelope `{ error: { code, details } }`
— client must normalize.

| Endpoint | Request | Response |
|---|---|---|
| `POST /api/v1/sessions` | `{ phone_number_id, number, display_phone?, business_account_id? }` | 201 session |
| `GET /api/v1/sessions` | — | `{ sessions: [...] }` |
| `GET /api/v1/sessions/:serial` | — | session / 404 |
| `POST /api/v1/sessions/:serial/pairing` | — | 202 `{ job_serial }` |
| `GET /api/v1/sessions/:serial/pairing/qr` | — | `{ status, qr_code }`; no QR → `{ status: "not_found", qr_code: null }` |
| `POST /api/v1/sessions/:serial/logout` | — | 202 `{ job_serial }` |
| `GET /api/v1/sessions/:serial/status` | — | `{ status }` |

Session shape: `id` (= serial), `phone_number_id`, `number`, `display_phone`,
`business_account_id`, `status`, `whatsapp_id`, `connected_at`,
`last_seen_at`, `logged_out_at`, `created_at`.
Status enum: `created | pairing | connected | disconnected | logged_out`.

Worker pairing flow (why polling works): API inserts `pairing` job → worker
marks session `pairing` → WhatsMeow `GetQRChannel` → **first** QR `code` event
stored with 5-min TTL → session reset to `created`. Therefore: QR availability
is decoupled from session status; **the only QR exposed per pairing job is the
first one — so "refresh QR" must issue a new `POST pairing` and re-poll.**

## Flows → endpoints (user-confirmed)

| # | Flow | UI | API calls |
|---|---|---|---|
| 1 | Create session | "Add Device" → modal form → submit | `POST /sessions` → 201; auto-advance to QR stage |
| 2 | Request QR | after create: auto `POST pairing` → poll `GET pairing/qr` → show QR; **refresh QR button** re-`POST pairing` + re-poll | `POST /sessions/:serial/pairing`, `GET .../pairing/qr` (poll 3s) |
| 3 | Reconnect | disconnected/logged_out card → "Reconnect" → open QrModal → poll | `POST pairing` + `GET pairing/qr` |
| 4 | Disconnect | **NOT valid — do not implement** (user decision; no backend route) | — |
| 5 | Logout | connected card → "Logout" → confirm → `POST logout` → poll `GET status` until `logged_out` | `POST /sessions/:serial/logout` |

Also **not implemented** (no backend / out of the confirmed flows): Delete,
Cancel-pairing. Omit these action buttons (do not render disabled placeholders
unless trivial).

## Architecture decisions (Next.js, App Router)

1. **Client-side data, SPA-style pages.** Product pages are `"use client"`
   fetching the API directly with `Authorization` header (never cookies — the
   API's CORS decision). Root `layout.tsx` stays a server component (fonts +
   tokens, unchanged).
2. **Route group for the app shell.** `src/app/(app)/layout.tsx` = client
   layout (Sidebar + Topbar + mobile toggle). Sidebar `active` derived from
   `usePathname()` instead of the current `items[].active` flag. Playground
   moves to `/playground`; `/` redirects to `/sessions` until the launcher
   (the launcher milestone) lands.
3. **API client** `src/lib/api/`:
   - `client.ts` — typed `fetch` wrapper: base URL `NEXT_PUBLIC_API_URL`
     (default `http://localhost:3000`), JSON, WABA error-envelope
     normalization, shared `Authorization` resolution (see 4).
   - `auth.ts` — resolution: `NEXT_PUBLIC_API_TOKEN` set → Bearer; else on 401
     → browser Basic prompt (password = `API_AUTH_TOKEN`), sessionStorage
     cache. (Full auth page = deferred B5.)
   - `types.ts` — `Session`, `SessionStatus`, `PairingQr { status, qr_code }`,
     `ApiError`.
   - `sessions.ts` — `listSessions`, `createSession`, `requestPairing`,
     `getPairingQr`, `logout`.
   - `.env.example`: `NEXT_PUBLIC_API_URL=http://localhost:3000`,
     `NEXT_PUBLIC_API_TOKEN=` (unset → Basic mode).
4. **Data hooks** `src/lib/hooks/` (no data-library dep):
   - `useSessions.ts` — list + `refresh()`; small status-poll helper
     (`pollStatus(serial, until, timeout)`).
   - `usePairingQr.ts` — QR polling: interval 3s, cleanup on unmount, states
     `generating | ready | expired | error`, `refresh()` (re-POST pairing +
     reset poll), `cancel()`.
5. **New deps (minimal, deliberate)**: `qrcode.react` (QR renderer; the design
   QR is a placeholder, product needs a real one). Dev: `vitest`, `jsdom`,
   `@testing-library/react`, `@testing-library/user-event`,
   `vite-tsconfig-paths` (`@/` → `src/`), `vitest.config.ts` + `src/test-setup.ts`,
   `"test": "vitest run"` in `package.json`.
6. **Design-system reuse only** — `Button`, `Badge`/`StatusDot`, `Modal`/
   `ModalActions`, `FormGroup`/`FormLabel`/`FormInput`/`FormHint`, `Alert`,
   `EmptyState`, `Tooltip`, `Card` pieces, `cx`. No new tokens; match
   `sessions.html` geometry (device grid `minmax(340px,1fr)`, meta rows, error
   banner, action rows).

## Target layout

```text
apps/dashboard/src/
  app/
    layout.tsx                     # server root (unchanged)
    page.tsx                       # redirect → /sessions (until launcher P5)
    playground/page.tsx            # moved design-system playground (git mv)
    (app)/
      layout.tsx                   # client shell: Sidebar + Topbar + mobile
      sessions/
        page.tsx                   # page: header + info alert + device grid
        components/
          DeviceCard.tsx           # per-status card + action rows
          AddDeviceModal.tsx       # stage 1 form → stage 2 QR (create flow)
          QrModal.tsx              # shared poll+render QR (create/reconnect/refresh)
  lib/api/
    client.ts  auth.ts  types.ts  sessions.ts
  lib/hooks/
    useSessions.ts  usePairingQr.ts
```

## Component spec

- **`DeviceCard`** — per `sessions.html` card: mono phone + label header,
  StatusDot + badge; meta rows (last seen / display name / account id);
  error banner for `disconnected`/`logged_out` ("Connection lost — device is
  disconnected. Reconnect to restore it."). Action rows by status:
  - `connected` → **Logout**
  - `pairing` → **Show QR**
  - `created` → **Start Pairing** (triggers flow 2)
  - `disconnected` / `logged_out` → **Reconnect** (primary, full-width)
  - Badge map: connected→success, pairing→warning, created→neutral,
    disconnected/logged_out→danger.
- **`AddDeviceModal`** — stage 1 form: `number` (Phone Number, required),
  `phone_number_id` (Phone Number ID, required — no API column for a free-text
  "Device Label"; `display_phone` optional, mapped to card label). Submit →
  `POST /sessions` → stage 2 = QrModal (auto `POST pairing` → poll).
- **`QrModal`** — shared; poll `GET pairing/qr` (3s):
  `generating` → spinner "Generating QR…"; `ready` → render `qrcode.react`
  + design instructions ("Open WhatsApp → Settings → Linked Devices…");
  `expired`/`not_found` past timeout → "QR expired — refresh";
  `error` → Alert + retry. **Refresh QR** button → `refresh()` (new
  `POST pairing`, reset poll). Cancel closes.
- **Logout** — confirm dialog → `POST logout` → poll `GET status` until
  `logged_out` (3s, ~15s timeout) → refresh list. Loading state on button.

## Phases (each lands green: `npm run build && npm run lint && npm test` in
dashboard, plus turbo root check, before the next)

### P1 — Routing shell
- `git mv src/app/page.tsx src/app/playground/page.tsx`; new root `page.tsx`
  redirects to `/sessions`.
- `src/app/(app)/layout.tsx` client shell: Sidebar + Topbar + mobile toggle;
  Sidebar `active` via `usePathname`. Nav hrefs: `/`, `/sessions`,
  `/api-keys`, `/webhooks`, `/jobs`, `/settings` (only `/sessions` has a page
  this phase; others may 404 → next/link or anchor per decision).
- Verify: dev on 3002, `/sessions` renders shell, playground still at
  `/playground`, no horizontal overflow 360–1920.

### P2 — API client + hooks
- `src/lib/api/*` and `src/lib/hooks/*` per decisions 3–4; `qrcode.react` +
  test deps installed; `vitest.config.ts` + setup.
- Verify: `npm test` green on pure units (client auth resolution, error
  normalization).

### P3 — Sessions page
- `sessions/page.tsx` + `DeviceCard` + `AddDeviceModal` + `QrModal` per spec;
  wire the five flows.
- Verify: live smoke against compose stack (see Verification).

### P4 — Tests
- Functional (mocked client): status→badge map, action-row availability per
  status, AddDevice two-stage flow, QrModal poll states (generating/ready/
  expired/error), refresh re-issues pairing, logout confirm + status poll.
- Verify: `npm test` green.

## Verification

- Root turbo: `npm run build` + `npm run lint` + `npm test` green (api +
  dashboard + worker).
- Live stack (compose: postgres :5433, postgrest :3001, api :3000; worker up):
  - create session → appears in grid (`created`)
  - Start Pairing → QR reaches `ready` (render verified); full connect needs a
    real WhatsApp device — **QR to `ready` is the ceiling** (same as
    current sessions milestone)
  - Refresh QR → new pairing job issued, new QR rendered
  - logout → status polls to `logged_out`, card flips to Reconnect
  - disconnect/delete/cancel buttons absent
- Responsive: no horizontal overflow at 360 / 480 / 768 / 1440 / 1920.
- Visual: compare rendered `/sessions` against `design/dashboard/sessions.html`.

## Out of scope / deferred

- Webhooks page (next UI milestone; separate plan).
- Dashboard overview, launcher, api-keys, jobs, and settings pages (later UI
  milestones).
- Backend: delete/disconnect session (B2), full auth (B5) — no frontend
  action today.

## Docs sync

- `HANDOFF.md`: append P1–P4 verification evidence.
- `docs/apps/README.md` + `apps/AGENTS.md`: note `/sessions` shipped, `test`
  script, `/playground` route.
