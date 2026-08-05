# Apps — Frontend

The UI/frontend area of the monorepo. One app per subdirectory, each a
workspace named `@waba/<name>` participating in the root turbo pipeline
(`build`/`dev`/`test`/`lint`).

Path: `apps/`

## Apps

### Dashboard — `apps/dashboard/` (`@waba/dashboard`)

The **Nexus developer portal**: React + Vite + TypeScript SPA that consumes the
Hono API under `../services/api/` over HTTP. Serves as the admin surface for
WhatsApp device sessions (QR pairing), webhook configs, and API keys.

- Entry point: `src/main.tsx` → `src/app/App.tsx` (react-router, root `/`
  redirects to `/sessions`).
- Design source: exported HTML under `design/dashboard/` (DESIGN-HANDOFF.md is
  the visual contract); design tokens live in `src/styles/tokens.css`.
- Routes: `/sessions` (device grid, two-stage add-device modal → QR pairing,
  status polling), `/webhooks` (config CRUD + subscriptions, delivery-log
  empty state), `/api-keys` (frontend-first, empty state — backend is B1).
  Nav items Dashboard/Jobs/Settings render disabled ("coming soon").
- Auth: env `VITE_API_TOKEN` → `Authorization: Bearer`; without it, a
  browser-side Basic Auth gate (password = API `API_AUTH_TOKEN`), credentials
  cached in sessionStorage. The API accepts both schemes and answers CORS
  (`CORS_ORIGINS`); see `../services/api/configuration.md`.
- API usage: `/api/v1/sessions*` (create, list, get, pairing, pairing/qr,
  logout, status) and `/api/v1/webhooks*` (list, get, create, patch, delete,
  subscriptions). Typed client in `src/api/`.
- Env: `.env.example` documents `VITE_API_URL` (default
  `http://localhost:3000`) and `VITE_API_TOKEN` (unset → Basic Auth mode).
- Toolchain: ESLint flat config + `eslint-plugin-react-hooks` +
  `eslint-plugin-react-refresh`; vitest + `@testing-library/react`.
- Tracked backend gaps: API keys backend (B1), session delete/disconnect (B2),
  delivery log (B3), webhook verification (B4), full login screen (B5),
  webhook test-delivery (B6), launcher route (B7) — see
  `.opencode/plans/dashboard.md`.
