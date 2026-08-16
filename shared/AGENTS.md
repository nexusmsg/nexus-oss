# Shared Guidelines (shared/db/migrations)

## Project Overview

`shared/db/` holds the single source of truth for the database schema:
golang-migrate SQL migrations consumed by the dashboard and the worker; the
worker applies migrations via `cmd/migrate` and the Docker `migrate` service.

Current migrations (apply order):

| Migration | Content |
|-----------|---------|
| `000001_create_jobs` | `set_updated_at()` trigger fn; `jobs` table (serial, type, phone_number_id, payload, status, attempts/max_attempts, available_at, claim fields, result, idempotency_key, timestamps, deleted_at) |
| `000002_create_webhook_configs` | `webhook_configs` (phone_number_id unique, webhook_url, webhook_secret, timestamps, deleted_at) |
| `000003_create_sessions` | `sessions` (status enum-like check, whatsapp_id, connection timestamps) + `session_qr_codes` (FK cascade, qr_code, status, expires_at) |
| `000004_webhook_management` | `webhook_configs` += enabled, max_retries, retry_delay_ms, timeout_ms; `webhook_subscriptions` (config FK, event_type, unique pair) + seed `messages` for existing configs |
| `000005_add_business_account_id_to_sessions` | `sessions.business_account_id` (text, default `''`) |
| `000007_create_whatsmeow_jobs` | Dispatcher→executor queue: `whatsmeow_jobs` (serial, `source_job_serial` → `jobs.serial`, no FK, status, attempts/max_attempts, available_at, claim fields, result, idempotency_key, timestamps, deleted_at) |
| `000008_add_qr_job_serial` | `session_qr_codes.job_serial` — links QR rows to the pairing job that produced them (avoids returning a stale QR) |
| `000009_allow_reuse_deleted_session_phone_number` | `sessions`: drop full unique on `phone_number_id`; partial unique index on active (`deleted_at is null`) rows only |
| `000010_allow_reuse_deleted_webhook_config_phone_number` | `webhook_configs`: same relaxation — reuse `phone_number_id` after soft delete |
| `000011_create_api_keys` | `api_keys` (serial PK, name, key_prefix, key_hash, scope read/write/full, status active/revoked, expires_at, last_used_at, timestamps, deleted_at) — plaintext secret returned once at creation, never stored |
| `000012_add_api_key_ciphertext` | `api_keys.key_ciphertext` — AES-256-GCM encrypted secret for on-demand reveal |

`000006` is intentionally unused in the sequence (documented in the
`000011_create_api_keys` header; do not "fill" the gap).

## Migration Rules

- One pair of files per change: `NNNNNN_snake_case.up.sql` + `.down.sql`,
  golang-migrate format, monotonically increasing `NNNNNN`.
- `up` must be idempotent where practical (`if not exists`, `add column if not
  exists`) — this project already follows that convention; keep it.
- `.down` must reverse the `.up` cleanly. It is for local dev rollback only;
  production rollback is handled by the release process, not `down` files.
- Never edit an already-applied migration to fix a schema bug; add a new
  migration instead.
- Keep `jobs`, `sessions`, `webhook_configs` status/state transitions
  consistent with the API + worker code that reads them (e.g. job statuses
  `pending`/`claimed`/`succeeded`/`failed`).

## Applying Migrations

Migrations are **baked into the Docker images**. After adding a new migration
file you must rebuild before applying:

```bash
docker compose build migrate
docker compose up -d migrate postgres
```

Or apply directly from the worker: `go run ./cmd/migrate -dsn <SUPABASE_DSN>`.

## Verification

- Every new migration needs a matching down migration.
- Schema changes that add/alter columns must be reflected in:
  - the dashboard API transport/service mapping (`apps/dashboard/src/lib/api/`),
  - the worker session/job stores (`services/worker/internal/adapters/queue/`),
  - the docs: `../../docs/shared/README.md` and affected service docs.
