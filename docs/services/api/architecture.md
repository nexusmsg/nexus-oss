# API — Architecture

## Design

The API follows the same hexagonal discipline as the worker: `domain` models
are dependency-free, `ports` declare contracts, `service` implements use
cases, `adapters` talk to the outside world (HTTP + PostgREST). Source:
`services/api/src/`.

```text
HTTP client ──► adapters/http (Hono app, auth)
                    │  handlers call service use cases
                    ▼
               service/ (use cases)
                    │  depend on ports
                    ▼
               ports/ (interfaces)
                    ▲
                    │
               adapters/supabase (PostgREST transport)
                    │
                    ▼
               PostgREST ──► Postgres
```

## Key flows

### Send message (outbound, async)
1. `POST /:phone_number_id/messages` → auth → WABA validation
   (`domain/outbound-message`).
2. Optional idempotency key (header wins over body).
3. Enqueue `send_message` job via PostgREST (`jobs` table).
4. Poll job row every `RESULT_POLL_MS` until terminal state
   (`SEND_TIMEOUT_MS` budget).
5. Return official WABA 200 envelope with `result.wa_message_id`, or a WABA
   error envelope (504 on timeout).

### Session lifecycle
- `POST /api/v1/sessions` is **idempotent** per `phone_number_id` (re-create
  returns the same serial).
- Pairing/logout enqueue jobs (`pairing`, `logout`) for the worker; QR is
  polled via `GET /api/v1/sessions/:serial/pairing/qr`.

### Webhook config management
- CRUD on `webhook_configs` (soft delete) + event-type subscriptions
  (`webhook_subscriptions`), default `messages` subscription seeded on create.

### Internal worker-facing routes
- `GET /internal/v1/webhook-config?phone_number_id=...` — worker fetches
  webhook URL/secret before forwarding inbound events.
- `POST /internal/v1/heartbeat` — worker refreshes `sessions.last_seen_at`.
- Both gated by `INTERNAL_TOKEN`; routes disabled (401) when unset.

## Auth model

- `API_AUTH_TOKEN` on public WABA routes (`/:phone_number_id/messages`) and
  `/api/v1/*`; accepted as `Authorization: Bearer <token>` **or**
  `Authorization: Basic base64(<user>:<token>)` against the same secret
  (`adapters/http/auth.ts`). Username free-form; password must equal the
  token. Bearer takes precedence when both schemes are present. Empty string
  disables auth for both.
- Auth failures return `401` with `WWW-Authenticate: Basic realm="nexus"` so
  browser-native Basic Auth (and reverse proxies) can drive the prompt.
- `INTERNAL_TOKEN` (Bearer) on `/internal/*` routes; empty string disables
  them (logged at app creation).
- Dev keys are HS256 JWTs (`{"role":"postgres"}`) signed with
  `PGRST_JWT_SECRET` — PostgREST rejects plain-string bearer tokens (PGRST301).

## CORS

- `/api/v1/*` uses Hono's built-in `cors` middleware, registered on the
  `apiV1` sub-router **before** the auth guard (Hono runs middleware in
  registration order; after the sub-router mount it would only fire for
  OPTIONS). Configured from `CORS_ORIGINS` (comma-separated allow-list;
  default `http://localhost:5173`; empty → middleware not registered). Allows
  methods `GET/POST/PATCH/DELETE/OPTIONS` and headers `Authorization`,
  `Content-Type`; credentials disabled (Basic travels as a header, not a
  cookie).

## Error envelope

All WABA routes return `{ "error": { "code": <int>, "details": ... } }`
(see `adapters/http/waba-error.ts`); validation failures use code 100.
