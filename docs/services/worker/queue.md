# Worker — Queue

Supabase/Postgres-backed job queue + session state sync. Source:
`services/worker/internal/adapters/queue/` (`store.go`, `consumer.go`,
`session_store.go`, `heartbeat.go`).

## Job store (`store.go`)

- One `Store` per table, selected at construction (`"jobs"` or
  `"whatsmeow_jobs"`); all SQL interpolates the trusted table name. Two
  instances can share one pgx pool via `NewStoreWithPool`.
- Claim model: `FOR UPDATE SKIP LOCKED` on the next pending job.
- Attempt counting: failed claims increment `attempts`; jobs exceeding
  `max_attempts` (default 3) are marked `failed` permanently.
- Job states: `pending` → `claimed` → `succeeded` / `failed`.
- `Enqueue`: `INSERT ... (type, phone_number_id, payload, idempotency_key,
  status, attempts, max_attempts, source_job_serial) VALUES (... 'pending', 0,
  ...) RETURNING serial` — used by `cmd/worker` to forward `jobs` rows into
  `whatsmeow_jobs`.
- `whatsmeow_jobs` rows carry `source_job_serial` (uuid → `jobs.serial`); the
  claim SELECT includes it so the executor can write the result back.
- The API polls the `jobs` table for terminal state and reads `result`.

## Consumer (`consumer.go`)

- Polls every `POLL_INTERVAL` (default 1s); graceful stop via signal ctx.
- On claim: resolves `JobHandler` for the job type, executes, then
  `Complete`/`Fail`/`RetryLater` with the handler's result/error.
- A handler error that is `ports.ErrDispatched` (send_message forwarded to
  `whatsmeow_jobs` by the dispatcher) is special-cased: the jobs row is left
  `claimed` — no Complete/Retry/Fail — because the whatsapp worker writes the
  terminal status back later.

## Session store (`session_store.go`)

- `ListSessions` — all session rows for boot sync / pairing health checks.
- `GetByPhoneNumberID` — session lookup used by the executor's lazy ensure.
- `UpdateHeartbeats(phoneNumbers)` — batched `sessions.last_seen_at` refresh
  (single statement, no per-row round trips).

## Heartbeat (`heartbeat.go`)

- Every `HEARTBEAT_INTERVAL` (default 10s): collect active devices from
  `DeviceManager.ActiveDevices()`, batch-update `last_seen_at`.
- Runs in the `cmd/whatsapp_worker` process; stops with the signal ctx.

## Webhook config provider (`adapters/apiconfig`)

- Fetches `GET {API_URL}/internal/v1/webhook-config?phone_number_id=...` from
  the API (bearer `INTERNAL_TOKEN`).
- In-memory cache with `WEBHOOK_CONFIG_TTL` (default 30s); 404 is cached as a
  negative result so repeated misses don't hammer the API.
