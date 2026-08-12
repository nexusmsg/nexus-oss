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

The active API lives in the dashboard as Next.js route handlers
(`apps/dashboard/src/app/api/`, `src/lib/api/server-auth.ts`). Public
`/api/v1/*` routes accept **two credential classes**, both via
`Authorization: Bearer <credential>`:

- **Bootstrap `API_AUTH_TOKEN`** — compared in constant time (`safeEqual`:
  both sides SHA-256 hashed, digests compared with `timingSafeEqual`).
  Bypasses scope checks and is the only credential authorized on the
  bootstrap-only API-key management routes.
- **Persisted API keys** — `waba_…` credentials resolved asynchronously by
  SHA-256 hash lookup of the full secret (`getKeyByHash`). Unknown, revoked,
  soft-deleted, and expired keys are rejected; the route's `requiredScope`
  (`read` for GET, `write` for POST/PATCH/DELETE; `full` grants both) is
  enforced. A successful persisted-key auth triggers a best-effort, throttled
  `last_used_at` update (at most once per key per five minutes) that is
  non-blocking and never fails the request. Management routes omit the
  persisted-key accessor entirely, so persisted keys never authorize them and
  no hash lookup is attempted.

When `API_AUTH_TOKEN` is empty, every public route is closed: neither the
bootstrap token nor persisted keys are accepted. Auth failures return the
WABA 401 envelope `{ error: { code: 401, ... } }`.

`INTERNAL_TOKEN` on `/internal/*` routes is **strictly isolated**:
`authorizeInternal` accepts only `INTERNAL_TOKEN` (constant-time comparison);
bootstrap and persisted credentials never authorize internal routes. Empty
string disables them (401).

## API keys

API-key CRUD is implemented in the dashboard (`src/lib/api/domain/api-key.ts`,
`service/api-key-management.ts`, `ports/api-key-transport.ts`, the
`ApiKeyTransport` slice of `DrizzleTransport`, and the
`/api/v1/api-keys/**` route handlers). The `api_keys` table comes from
migration `000011_create_api_keys`, mirrored in `shared/db/schema.ts`.

- **Key format**: `waba_<environment>_<random-secret>`, where the random
  secret is at least 32 CSPRNG bytes (`randomBytes`) hex-encoded (64 hex
  chars). `<environment>` comes from `API_KEY_ENV` → `NODE_ENV` → `dev`,
  normalized to `[a-z0-9-]`.
- **Storage**: only a SHA-256 hex digest of the full secret (`key_hash`,
  unique index for constant-time lookup) and a non-secret display prefix
  (`key_prefix`) are persisted. The plaintext secret is returned exactly once
  from `POST /api/v1/api-keys` and is never stored, logged, or recoverable.
- **Bootstrap-only management**: `/api/v1/api-keys/**` (list, create, get,
  rename/scope/expiry, revoke) is authorized only by `API_AUTH_TOKEN`;
  persisted keys can never manage keys.
- **Expiry / revocation**: an `expires_at` in the past rejects the credential;
  `DELETE` maps to `revokeKey` (`status = 'revoked'`, never hard-deleted);
  soft-deleted rows (`deleted_at` set) are excluded from hash lookup and
  management reads.
- **`last_used_at` throttling**: updated only after successful persisted-key
  auth, at most once per key per five minutes (`LAST_USED_THROTTLE_MS`). The
  authorizer skips the write inside the window and the adapter's conditional
  `UPDATE` (live, non-expired rows only) is a race-safety backstop. Never
  updated for failed, expired, or revoked credentials.
- **Scope matrix**: GET routes require `read`, POST/PATCH/DELETE require
  `write`, `full` grants both, bootstrap bypasses all checks.

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
