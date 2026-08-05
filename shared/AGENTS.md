# Shared Guidelines (shared/db/migrations)

## Project Overview

`shared/db/` holds the single source of truth for the database schema:
golang-migrate SQL migrations consumed by both services (the API reads the
schema through PostgREST; the worker applies migrations via `cmd/migrate` and
the Docker `migrate` service).

Current migrations (apply order):

| Migration | Content |
|-----------|---------|
| `000001_create_jobs` | `set_updated_at()` trigger fn; `jobs` table (serial, type, phone_number_id, payload, status, attempts/max_attempts, available_at, claim fields, result, idempotency_key, timestamps, deleted_at) |
| `000002_create_webhook_configs` | `webhook_configs` (phone_number_id unique, webhook_url, webhook_secret, timestamps, deleted_at) |
| `000003_create_sessions` | `sessions` (status enum-like check, whatsapp_id, connection timestamps) + `session_qr_codes` (FK cascade, qr_code, status, expires_at) |
| `000004_webhook_management` | `webhook_configs` += enabled, max_retries, retry_delay_ms, timeout_ms; `webhook_subscriptions` (config FK, event_type, unique pair) + seed `messages` for existing configs |
| `000005_add_business_account_id_to_sessions` | `sessions.business_account_id` (text, default `''`) |

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
docker compose up -d migrate postgres postgrest
docker compose restart postgrest   # reload the PostgREST schema cache
```

Or apply directly from the worker: `go run ./cmd/migrate -dsn <SUPABASE_DSN>`.

## Verification

- Every new migration needs a matching down migration.
- Schema changes that add/alter columns must be reflected in:
  - the API transport/service mapping (`services/api/src/adapters/supabase/`),
  - the worker session/job stores (`services/worker/internal/adapters/queue/`),
  - the docs: `../../docs/shared/README.md` and affected service docs.
