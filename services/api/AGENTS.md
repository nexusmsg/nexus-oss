# API Guidelines (services/api)

## Project Overview

`@waba/api` is a Node.js (Hono) HTTP service that exposes a WABA-compatible
surface: send-message (job enqueue + synchronous result wait), session
lifecycle (create/pair/QR/logout/status), webhook-config management, and
internal worker-facing routes. It talks to Postgres via bare PostgREST
(`@supabase/postgrest-js`, no `/rest/v1` prefix) and is deployable on Vercel
(`api/` entry, no listener).

## Architecture

Same hexagonal discipline as the Go worker — one-way dependency direction:

```text
src/
  index.ts             Vercel entry (no listener)
  compose.ts           buildApp(config) composition root
  config.ts            loadConfig() — env parsing, no service logic
  adapters/http/       Hono app, routes, Bearer auth, WABA error envelope
  adapters/supabase/   PostgREST transport + error mapping
  domain/              session, outbound-message, webhook-config models
  ports/               TS interfaces for services/transports
  service/             use cases: send-message, session, webhook-config-mgmt
```

- `domain` — dependency-free models and validation. No framework types.
- `ports` — interfaces declared for capabilities the service layer needs.
- `service` — use cases implementing the application behavior; depends only on
  `domain` and `ports`.
- `adapters` — Hono routes and PostgREST transport; implements the ports.
- `compose.ts` — the only place concrete adapters are wired to services.

## Route/Handler Conventions

- Public WABA routes (`/:phone_number_id/messages`) and `/api/v1/*` routes are
  guarded by Bearer `API_AUTH_TOKEN` (`adapters/http/auth.ts`).
- `/internal/v1/*` routes are guarded by `INTERNAL_TOKEN`; when that env var is
  empty the routes are disabled and return 401.
- All WABA-facing failures return the official error envelope
  `{ error: { code, details } }` via `adapters/http/waba-error.ts`; validation
  errors use code `100`.
- Send-message is async: enqueue job → poll job row (`RESULT_POLL_MS`) until
  terminal state → return the WABA 200 envelope with the real `wamid`, or a
  WABA error (504 on `SEND_TIMEOUT_MS`).
- Session create is idempotent per `phone_number_id`.

## DB Access Rules

- Use PostgREST via `@supabase/postgrest-js`; do not add supabase-js or raw
  SQL to the API package.
- The service-role key must be a valid PostgREST token. In dev that is an HS256
  JWT `{"role":"postgres"}` signed with `PGRST_JWT_SECRET`; plain-string bearer
  tokens fail with PGRST301.
- Keep query building inside `adapters/supabase/transport.ts`; do not spread
  PostgREST builder calls across services.

## Config

All env vars are read in `config.ts` and passed down as a single config object;
never read `process.env` inside services or adapters. See
`../../docs/services/api/configuration.md` for the full table.

## Testing and Verification

Before submitting changes, run the narrowest relevant checks:

```bash
npm test                 # vitest run (hermetic: fakes/mocks, no external svc)
npx tsc --noEmit         # type check
npm run build            # full compile
```

Live integration (`src/adapters/http/app.integration.test.ts`) requires a real
PostgREST + Postgres and is gated by `TEST_SUPABASE_URL` / key — skipped when
unset. It needs migrations applied and `docker compose restart postgrest` after
a migration change. Integration test rows use an `itest-<timestamp>-` prefix
and are hard-deleted in `afterAll`.

## Change Boundaries

- Prefer the smallest change that preserves the existing architecture.
- When changing a port, inspect every implementation and caller first; ports
  are the contract between layers.
- Keep WABA payload shapes exact — this service's contract is compatibility
  with the real WhatsApp Business API.
- Keep `docs/services/api/*` in sync when routes, config, or architecture
  change (see root `AGENTS.md` docs rule).
