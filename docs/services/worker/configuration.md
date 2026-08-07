# Worker — Configuration

All values are read from environment variables via
`internal/config/config.go` (`Load`).

| Env var | Default | Description |
|---------|---------|-------------|
| `SUPABASE_DSN` | — (required) | Postgres DSN for the queue/session store |
| `MIGRATIONS_DIR` | `../../shared/db/migrations` | golang-migrate source path (relative to the worker) |
| `WHATSMEOW_STORE_DSN` | — (required) | Postgres DSN for WhatsMeow's own device-session store |
| `BUSINESS_ACCOUNT_ID` | — (required) | WABA business account id (`entry[].id`) in outbound context |
| `API_URL` | — (required) | Internal API base URL for webhook-config fetch |
| `INTERNAL_TOKEN` | — (required) | Bearer token for the internal API routes |
| `POLL_INTERVAL` | `1s` | Queue consumer claim interval |
| `MAX_ATTEMPTS` | `3` | Max job attempts before permanent failure |
| `WEBHOOK_CONFIG_TTL` | `30s` | Webhook-config cache TTL (negative results cached too) |
| `HEARTBEAT_INTERVAL` | `10s` | `last_seen_at` batch-update interval |

## CLI

- `go run ./cmd/migrate -dsn <SUPABASE_DSN>` — apply migrations
  (`shared/db/migrations`, golang-migrate format).
- `go run ./cmd/worker` — start the stateless dispatcher (jobs →
  `whatsmeow_jobs`; no WhatsMeow, scalable).
- `go run ./cmd/whatsapp_worker` — start the stateful executor
  (`whatsmeow_jobs` → jobs write-back; owns WhatsMeow, single instance).

Both worker binaries read the same env block; `cmd/worker` ignores the
WhatsMeow/session-related vars (`WHATSMEOW_STORE_DSN`, `BUSINESS_ACCOUNT_ID`,
`HEARTBEAT_INTERVAL`, `API_URL`, `INTERNAL_TOKEN`, `WEBHOOK_CONFIG_TTL`).
