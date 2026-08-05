# API — Node.js Hono

WABA-compatible HTTP surface: job enqueue + synchronous result wait, session
lifecycle, webhook-config management, and internal worker-facing routes.

Path: `services/api/`

## Sections

| Section | Content |
|---------|---------|
| [architecture.md](architecture.md) | Hexagonal layout, data flow, ports |
| [endpoints.md](endpoints.md) | Full HTTP surface with payload shapes |
| [configuration.md](configuration.md) | Environment variables and defaults |
| [testing.md](testing.md) | Unit + live integration test setup |

## Quick facts

- Framework: Hono; runs on Node.js, deployable on Vercel (`api/` entry).
- DB access: PostgREST via `@supabase/postgrest-js` (not supabase-js — bare
  PostgREST has no `/rest/v1` prefix).
- Outbound sends are **asynchronous**: `POST /:phone_number_id/messages`
  enqueues a `send_message` job, polls the job row until terminal state, and
  returns the official WABA envelope with the real `wamid`.
- Session `business_account_id` (optional) is persisted per session and used by
  the worker as the WABA webhook `entry[].id`.

## Layout

```text
src/
  index.ts          Vercel entry (no listener)
  compose.ts        buildApp(config) — composition root
  config.ts         environment config
  adapters/http/    Hono app, auth, WABA error envelope
  adapters/supabase PostgREST transport + error mapping
  domain/           session, outbound-message, webhook-config models
  ports/            TS interfaces for services/transport
  service/          use cases: send-message, session, webhook-config-mgmt
```
