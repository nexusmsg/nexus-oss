# API — Endpoints

The active API is hosted in the dashboard app as Next.js route handlers under
`apps/dashboard/src/app/api/` (Drizzle/Postgres backing). Base URL:
`{{base_url}}` (dashboard API default `http://localhost:3000`).

## Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | `{"ok": true, "service": "api"}` (legacy Hono surface; the dashboard serves its UI at `/`) |

## Public WABA surface (auth: Bearer `API_AUTH_TOKEN`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/:phone_number_id/messages` | Send message: enqueue + poll → WABA envelope with `wamid`, or WABA error (504 on timeout) |

Auth accepts `Authorization: Bearer <credential>`; the credential is either
the bootstrap `API_AUTH_TOKEN` or a persisted API key (`waba_…`, resolved by
SHA-256 hash — see "API key management" and "Persisted-key authentication"
below). Failures return the WABA 401 envelope.

## Session lifecycle (`/api/v1`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/sessions` | Create session (idempotent per `phone_number_id`); body `{ phone_number_id, number, display_phone?, business_account_id? }` → 201 |
| GET | `/sessions` | List sessions |
| GET | `/sessions/:serial` | Get session by serial (404 if absent) |
| POST | `/sessions/:serial/pairing` | Enqueue pairing job → 202 `{ job_serial }` |
| GET | `/sessions/:serial/pairing/qr` | Poll QR: `{ status, qr_code }` (`not_found` until worker posts) |
| POST | `/sessions/:serial/logout` | Enqueue logout job → 202 `{ job_serial }` |
| GET | `/sessions/:serial/status` | `{ status }` (`created`/`pairing`/`connected`/`disconnected`/`logged_out`) |

Session JSON shape: `id` (serial), `phone_number_id`, `number`,
`display_phone`, `business_account_id`, `status`, `whatsapp_id`,
`connected_at`, `last_seen_at`, `logged_out_at`, `created_at`.

## Webhook config management (`/api/v1`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/webhooks` | Create config; body `{ phone_number_id, webhook_url, webhook_secret? }` → 201 (duplicate phone → 400 code 100). Retry/timeout/enabled are **PATCH-only** — silently ignored on POST |
| GET | `/webhooks` | List configs |
| GET | `/webhooks/:serial` | Get config |
| PATCH | `/webhooks/:serial` | Patch `{ webhook_url?, webhook_secret?, enabled?, max_retries?, retry_delay_ms?, timeout_ms? }` |
| DELETE | `/webhooks/:serial` | Soft delete → 200 `{ ok }` (404 afterwards) |
| GET | `/webhooks/:serial/subscriptions` | List subscriptions (default `["messages"]`) |
| POST | `/webhooks/:serial/subscriptions` | Add subscription; body `{ event_type }` → 201 (idempotent) |
| DELETE | `/webhooks/:serial/subscriptions/:eventType` | Remove subscription → 200 `{ ok }` |

## API key management (`/api/v1`) — bootstrap-only

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/api-keys` | List keys (redacted records, newest first) |
| POST | `/api/v1/api-keys` | Create key; body `{ name, scope, expires_at? }` (`scope`: `read`/`write`/`full`) → 201 `{ key, secret }`. The plaintext `secret` is returned **only** here, exactly once |
| GET | `/api/v1/api-keys/:serial` | Get key (redacted); 404 if absent |
| PATCH | `/api/v1/api-keys/:serial` | Update `{ name?, scope?, expires_at? }`; `expires_at: null` clears expiry; 404 if absent |
| DELETE | `/api/v1/api-keys/:serial` | Revoke key → 200 `{ ok }`; keys are revoked, never hard-deleted; 404 if absent |

Management routes are authorized **only** by the bootstrap `API_AUTH_TOKEN`
(Bearer). Persisted API keys can never list, create, update, or revoke other
keys — they get the WABA 401 envelope and no hash lookup is attempted.

Redacted key JSON: `{ serial, name, key_prefix, scope, status, expires_at,
last_used_at, created_at, updated_at }`. It never contains the secret or its
SHA-256 digest. `status` is `active` or `revoked`.

Key format: `waba_<environment>_<64 hex chars>` (256 bits of CSPRNG entropy;
`<environment>` from `API_KEY_ENV` → `NODE_ENV` → `dev`, normalized to
`[a-z0-9-]`). Only the SHA-256 hex digest of the full secret and the
non-secret `waba_<environment>_` display prefix are persisted; the plaintext
secret is never stored, logged, or recoverable.

## Persisted-key authentication (public `/api/v1` routes)

Public `/api/v1` routes accept either credential class via
`Authorization: Bearer <credential>`:

- the bootstrap `API_AUTH_TOKEN` — constant-time comparison, bypasses scope;
- a persisted API key — resolved asynchronously by SHA-256 hash lookup of the
  full credential. Unknown, revoked, soft-deleted, and expired keys are
  rejected.

Scope mapping: GET routes require `read`; POST/PATCH/DELETE require `write`;
`full` grants both. Bootstrap auth bypasses scope checks. A successful
persisted-key auth triggers a best-effort, throttled `last_used_at` update (at
most once per key per five minutes) that is non-blocking and never fails the
request. `last_used_at` is never updated for failed, expired, or revoked
credentials.

When `API_AUTH_TOKEN` is empty, every public route is closed — neither the
bootstrap token nor persisted keys are accepted.

## CORS

`/api/v1/*` answers cross-origin browser calls (the dashboard calls the API
directly, no proxy). Allow-list from `CORS_ORIGINS` (comma-separated; default
`http://localhost:5173`; empty → CORS off). Methods
`GET/POST/PATCH/DELETE/OPTIONS`; headers `Authorization`, `Content-Type`; no
credentials.

## Internal worker-facing routes (Bearer `INTERNAL_TOKEN`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/internal/v1/webhook-config?phone_number_id=...` | `{ webhook_url, webhook_secret }`; 404 when absent |
| POST | `/internal/v1/heartbeat` | Body `{ phone_number_id }` → refresh `last_seen_at` → 200 `{ ok }` |
| GET | `/internal/webhook-config?phone_number_id=...` | Legacy alias of the v1 route |

Strict isolation: `/internal/*` accepts **only** `INTERNAL_TOKEN`
(constant-time comparison). Neither the bootstrap `API_AUTH_TOKEN` nor
persisted API keys ever authorize internal routes; the routes are disabled
(401) when the token is unset. The worker's outbound calls are unaffected —
it has no API-key changes.
