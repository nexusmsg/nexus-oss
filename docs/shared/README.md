# Shared — DB Migrations

SQL migrations in golang-migrate format, shared by both services (applied via
`services/worker/cmd/migrate` and the Docker `migrate` service). Path:
`shared/db/migrations/`.

## Migrations

| File | Content |
|------|---------|
| `000001_create_jobs` | `set_updated_at()` trigger fn; `jobs` table (serial, type, phone_number_id, payload, status, attempts/max_attempts, available_at, claim fields, result, idempotency_key, timestamps, deleted_at) |
| `000002_create_webhook_configs` | `webhook_configs` (phone_number_id unique, webhook_url, webhook_secret, timestamps, deleted_at) |
| `000003_create_sessions` | `sessions` (status check, whatsapp_id, connection timestamps) + `session_qr_codes` (FK cascade, qr_code, status, expires_at) |
| `000004_webhook_management` | `webhook_configs` += enabled, max_retries, retry_delay_ms, timeout_ms; `webhook_subscriptions` (config FK, event_type, unique pair) + seed `messages` for existing configs |
| `000005_add_business_account_id_to_sessions` | `sessions.business_account_id` (text, default `''`) |
| `000009_allow_reuse_deleted_session_phone_number` | `sessions.phone_number_id` unique only for active sessions: drops the full unique constraint `sessions_phone_number_id_key` and adds partial unique index `sessions_phone_number_id_active_idx` (`where deleted_at is null`) so a deleted session's phone number can be reused |
| `000010_allow_reuse_deleted_webhook_config_phone_number` | `webhook_configs.phone_number_id` unique only for active configs: drops the full unique constraint `webhook_configs_phone_number_id_key` and adds partial unique index `webhook_configs_phone_number_id_active_idx` (`where deleted_at is null`) so a deleted config's phone number can be reused |
| `000011_create_api_keys` | `api_keys` (serial PK, name, key_prefix, key_hash unique index, scope `read`/`write`/`full` check, status `active`/`revoked` check, expires_at, last_used_at, timestamps, deleted_at) — global Bearer credentials for the dashboard API; stores only a SHA-256 hex digest of the full secret plus a non-secret display prefix; `set_updated_at()` trigger; `api_keys_status_idx` partial index (`where deleted_at is null`) |

## Working with migrations

- Migrations are **baked into the Docker images** — after adding a new
  migration file you must rebuild before applying:
  ```bash
  docker compose build migrate
  docker compose up -d migrate postgres
  ```
- Apply via the worker CLI: `go run ./cmd/migrate -dsn <SUPABASE_DSN>`.
- `down` migrations exist for local dev rollback; production rollback is
  handled by the release process, not `down` files.

## Rules

- New migrations: monotonic `NNNNNN` prefix, idempotent `up` (`if not exists`),
  matching `.down`.
- Never edit an applied migration; add a new one.
- Schema changes must be mirrored in the API Drizzle schema
  (`shared/db/schema.ts`, consumed by the dashboard route handlers in
  `apps/dashboard/src/lib/api/adapters/db/`), the worker queue/session stores
  (`services/worker/internal/adapters/queue/`), and this doc.
