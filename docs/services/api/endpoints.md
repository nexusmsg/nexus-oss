# API — Endpoints

Base URL: `{{base_url}}` (default `http://localhost:3000`).

## Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | `{"ok": true, "service": "api"}` |

## Public WABA surface (Bearer `API_AUTH_TOKEN`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/:phone_number_id/messages` | Send message: enqueue + poll → WABA envelope with `wamid`, or WABA error (504 on timeout) |

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
| POST | `/webhooks` | Create config; body `{ phone_number_id, webhook_url, webhook_secret?, max_retries?, retry_delay_ms?, timeout_ms?, enabled? }` → 201 (duplicate phone → 400 code 100) |
| GET | `/webhooks` | List configs |
| GET | `/webhooks/:serial` | Get config |
| PATCH | `/webhooks/:serial` | Patch retry policy fields |
| DELETE | `/webhooks/:serial` | Soft delete → 200 `{ ok }` (404 afterwards) |
| GET | `/webhooks/:serial/subscriptions` | List subscriptions (default `["messages"]`) |
| POST | `/webhooks/:serial/subscriptions` | Add subscription; body `{ event_type }` → 201 (idempotent) |
| DELETE | `/webhooks/:serial/subscriptions/:eventType` | Remove subscription → 200 `{ ok }` |

## Internal worker-facing routes (Bearer `INTERNAL_TOKEN`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/internal/v1/webhook-config?phone_number_id=...` | `{ webhook_url, webhook_secret }`; 404 when absent |
| POST | `/internal/v1/heartbeat` | Body `{ phone_number_id }` → refresh `last_seen_at` → 200 `{ ok }` |
| GET | `/internal/webhook-config?phone_number_id=...` | Legacy alias of the v1 route |
