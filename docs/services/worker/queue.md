# Worker — Queue

Supabase/Postgres-backed job queue + session state sync. Source:
`services/worker/internal/adapters/queue/` (`store.go`, `consumer.go`,
`session_store.go`, `heartbeat.go`).

## Job store (`store.go`)

- Claim model: `FOR UPDATE SKIP LOCKED` on the next pending job.
- Attempt counting: failed claims increment `attempts`; jobs exceeding
  `MAX_ATTEMPTS` (default 3) are marked `failed` permanently.
- Job states: `pending` → `processing` → `succeeded` / `failed`.
- Fields: `id` (bigint), `type` (`send_message`, `pairing`, `logout`),
  `payload` (JSONB), `result` (JSONB), `attempts`, `status`, `error`,
  `run_at`, `created_at`, `started_at`, `completed_at`.
- The API polls this table for terminal state and reads `result`.

## Consumer (`consumer.go`)

- Polls every `POLL_INTERVAL` (default 1s); graceful stop via signal ctx.
- On claim: resolves `JobHandler` for the job type (`executor` for
  `send_message`/`pairing`/`logout`), executes, then `Complete`/`Fail` with the
  handler's result/error.

## Session store (`session_store.go`)

- `ListSessions` — all session rows for boot sync / pairing health checks.
- `GetByPhoneNumberID` — session lookup used by the executor's lazy ensure.
- `UpdateHeartbeats(phoneNumbers)` — batched `sessions.last_seen_at` refresh
  (single statement, no per-row round trips).

## Heartbeat (`heartbeat.go`)

- Every `HEARTBEAT_INTERVAL` (default 10s): collect active devices from
  `DeviceManager.ActiveDevices()`, batch-update `last_seen_at`.
- Runs in a goroutine; stops with the signal ctx.

## Webhook config provider (`adapters/apiconfig`)

- Fetches `GET {API_URL}/internal/v1/webhook-config?phone_number_id=...` from
  the API (bearer `INTERNAL_TOKEN`).
- In-memory cache with `WEBHOOK_CONFIG_TTL` (default 30s); 404 is cached as a
  negative result so repeated misses don't hammer the API.
