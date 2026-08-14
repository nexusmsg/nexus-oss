# waba-api-unofficial

Unofficial WABA (WhatsApp Business API) replicator — run your own WhatsApp
Business API-compatible surface so you can test and prototype integrations
without a live Business account or Meta approval.

## What it does

- **WABA-compatible HTTP API** for API keys, sessions, and webhooks, plus the
  event pipeline that turns real WhatsApp activity into WABA-shaped webhook
  payloads.
- **Dashboard** (Next.js) — management UI for API keys, WhatsApp sessions
  (QR login / pairing), and webhook configuration. Same process as the API.
- **Worker** (Go + WhatsMeow) — owns WhatsApp device connections, executes
  outbound sends from the queue, and forwards inbound events to your webhook
  endpoints with retry.

## Architecture

```text
apps/
  dashboard/              # Next.js app: /api/v1/* API + /api/internal/* + management UI
services/
  worker/                 # Go + WhatsMeow gateway (two binaries, see below)
shared/
  db/migrations/          # SQL migrations (golang-migrate format)
```

```text
┌────────────┐   HTTP (Bearer)   ┌────────────────────────────┐
│  Client /  │ ────────────────► │  apps/dashboard (Next.js)  │
│  Dashboard │                   │  /api/v1  public API        │
└────────────┘                   │  /api/internal  worker API  │
                                 └──────────┬─────────┬────────┘
                                            │         │ Postgres
                                            ▼         ▼
                                  ┌─────────────────────────┐
                                  │  Postgres (jobs queue,  │
                                  │  sessions, webhooks,    │
                                  │  api_keys)              │
                                  └───────────┬─────────────┘
                                              │ jobs
                                  ┌───────────▼─────────────┐
                                  │  worker (Go/WhatsMeow)  │
                                  │  cmd/worker dispatcher  │
                                  │  cmd/whatsapp_worker    │
                                  └────────────┬────────────┘
                                               │
                                          WhatsApp (device)

  Inbound events ─► worker ─► webhook payload ─► your webhook URL (retried w/ backoff)
```

The worker runs as two binaries that talk through the `whatsmeow_jobs` queue:

- `cmd/worker` — stateless dispatcher: polls `jobs`, forwards to
  `whatsmeow_jobs`. Horizontally scalable.
- `cmd/whatsapp_worker` — stateful executor: owns WhatsMeow clients, executes
  sends, writes terminal status back to `jobs`. Single instance.

See `docs/README.md` for the full docs graph.

## Self-hosting guide

### Prerequisites

- **Node.js 20+** (developed on v22)
- **Docker** (OrbStack or Docker Desktop) for Postgres + migrations
- **Go 1.2x+** for the worker
- **WhatsApp device** (phone number) to pair — required for sessions/messaging

### 1. Clone and install

```bash
git clone <your-fork> && cd waba-api-unofficial
npm install            # installs all workspace dependencies
```

### 2. Configure environment

Copy the example and set the required values:

```bash
cp .env.example .env
cp apps/dashboard/.env.example apps/dashboard/.env   # if present
```

Generate an encryption key for API-key secrets at rest (32 random bytes,
base64):

```bash
openssl rand -base64 32
```

| Variable | Where | Required | Purpose |
|----------|-------|----------|---------|
| `POSTGRES_PORT` | root `.env` | — | Host port for Postgres (default `5433`) |
| `POSTGRES_PASSWORD` | root `.env` | — | Postgres password (dev default `postgres`) |
| `DATABASE_URL` | both | ✅ | `postgres://postgres:<pw>@localhost:5433/waba` |
| `API_AUTH_TOKEN` | both | ✅ | Bootstrap Bearer token for `/api/v1/*`. **Management routes are bootstrap-only; persisted keys can never call them.** Empty = all public routes closed |
| `INTERNAL_TOKEN` | both | ✅ | Bearer token for `/api/internal/*` (worker ↔ API). Empty = internal routes disabled |
| `API_KEY_ENCRYPTION_KEY` | dashboard `.env` | ✅ | Base64 32-byte AES-256-GCM key. **Without it, key create/reveal fail closed (500s)** |
| `API_KEY_ENCRYPTION_KEY_PREVIOUS` | dashboard `.env` | rotation only | Previous key during rotation so old ciphertexts still decrypt |
| `NEXT_PUBLIC_API_TOKEN` | dashboard `.env` | — | When set, the dashboard always sends `Authorization: Bearer <token>`. When blank, it prompts for the token on first 401 |
| `API_KEY_ENV` | dashboard `.env` | — | Environment label in key prefixes (`waba_<env>_…`); defaults to `NODE_ENV`/`dev` |
| `SEND_TIMEOUT_MS` | root `.env` | — | Max ms to wait for a send job (default `25000`) |
| `RESULT_POLL_MS` | root `.env` | — | Job poll interval (default `250`) |
| `HEARTBEAT_TTL_MS` | root `.env` | — | Worker heartbeat TTL (default `30000`) |
| `CORS_ORIGINS` | dashboard `.env` | — | Comma-separated allow-list for cross-origin API calls |
| `BUSINESS_ACCOUNT_ID` | root `.env` | — | Business account id (worker) |
| `WHATSMEOW_STORE_DSN` | root `.env` | — | WhatsMeow session-store DSN |
| `API_URL` | root `.env` | — | Base URL the worker uses to reach the API (default `http://localhost:3002`) |
| `WEBHOOK_CONFIG_TTL` | root `.env` | — | Webhook-config cache TTL (default `30s`) |
| `HEARTBEAT_INTERVAL` | root `.env` | — | Worker heartbeat interval (default `10s`) |
| `POLL_INTERVAL`, `MAX_ATTEMPTS`, `MIGRATIONS_DIR` | root `.env` | — | Worker queue polling, send attempts, migration path |

### 3. Start Postgres and apply migrations

```bash
docker compose build migrate
docker compose up -d postgres migrate
# verify: the migrate service exits 0 and the version table shows the latest
docker compose exec postgres psql -U postgres -d waba -c "select version, dirty from schema_migrations order by version desc limit 1"
```

The tracked SQL in `shared/db/migrations/` is the single source of truth — do
not apply untracked or locally generated migration files.

### 4. Run the dashboard (API + UI)

```bash
cd apps/dashboard
npm run dev            # http://localhost:3000 (or: -p 3100 if 3000 is taken)
```

Production-style:

```bash
cd apps/dashboard
npm run build && npm run start
```

### 5. Run the worker (Go)

```bash
cd services/worker
go build ./cmd/worker ./cmd/whatsapp_worker
./worker            # stateless dispatcher (scalable)
./whatsapp_worker   # stateful WhatsMeow executor (single instance)
```

The worker reads env from the root `.env` (godotenv). For a first run you only
need Postgres + the API up; WhatsApp features require pairing a device (below).

### 6. Using the API

Everything is Bearer-authenticated. Two credential types:

- **Bootstrap token** (`API_AUTH_TOKEN`) — full access, incl. the management
  and reveal routes.
- **Persisted API keys** (`waba_<env>_…`, created via the API or dashboard) —
  scope-based (`read` / `write` / `full`), lifecycle + expiry enforced. Cannot
  call management routes.

```bash
TOKEN="<API_AUTH_TOKEN or waba_...>"

# Create an API key (bootstrap only)
curl -X POST http://localhost:3000/api/v1/api-keys \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"CI","scope":"full","expires_at":null}'
# → { "key": { "serial": "...", "key_prefix": "waba_..." }, "secret": "waba_..._<64hex>" }
#   secret is shown once at creation — store it securely.

# Reveal a key's secret on demand (bootstrap only, rate-limited, server-side decrypt)
curl http://localhost:3000/api/v1/api-keys/<serial>/secret -H "Authorization: Bearer $TOKEN"
# → { "secret": "waba_..._<64hex>" }

# Sessions: list / create / status / pairing / QR / logout
curl http://localhost:3000/api/v1/sessions -H "Authorization: Bearer $TOKEN"

# Webhooks: configure a delivery endpoint and subscribe to event types
curl -X POST http://localhost:3000/api/v1/webhooks -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"my-handler","url":"https://example.com/waba","phone_number_id":"+15550000000"}'
```

#### Session lifecycle (QR login / pairing)

1. `POST /api/v1/sessions` — create a session (optionally with a
   `business_account_id`).
2. `POST /api/v1/sessions/<serial>/pairing` — start pairing; returns a job
   serial.
3. `GET /api/v1/sessions/<serial>/pairing/qr` — get the QR to scan with the
   WhatsApp mobile app.
4. `GET /api/v1/sessions/<serial>/status` — connection status.
5. `POST /api/v1/sessions/<serial>/logout` — disconnect and remove the
   session.

#### Webhooks / events

Configure a webhook with a delivery URL, subscribe to event types
(`messages`, etc.), and the worker forwards inbound WhatsApp events to that
URL as WABA-shaped payloads with retry/backoff. `POST /api/v1/webhooks/<serial>/test`
fires a test payload. Payload mapping details: `services/worker/docs/api-mapping-webhook.md`.

### 7. Testing

```bash
npm test          # all workspaces (dashboard unit tests via vitest)
npm run lint
npm run build

# Dashboard integration suite (real Postgres, gated on TEST_DATABASE_URL):
cd apps/dashboard
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/waba \
  npx vitest run src/app/api/v1/api-keys/route.integration.test.ts

# Worker:
cd services/worker && go test ./...
```

### Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| API key create/reveal returns 500 | `API_KEY_ENCRYPTION_KEY` unset in `apps/dashboard/.env` — the feature fails closed by design |
| `/api/v1/*` returns 401 | Wrong or empty `API_AUTH_TOKEN`; persisted keys can't call management routes |
| Postgres connection refused on 5433 | `docker compose up -d postgres` not running, or another Postgres owns the port |
| Page shows "Internal Server Error" | Dashboard can't reach Postgres — check `DATABASE_URL` and the postgres container |
| Port 3000 taken | Run the dashboard on another port: `next dev -p 3100` |
| Worker can't reach the API | `API_URL` in root `.env` must point at the dashboard port |
| Reveal returns 410 | Key predates ciphertext storage (`key_ciphertext` NULL) — not recoverable by design |
| Reveal returns 429 | Per-serial reveal rate limit (10 / 5 min) exceeded |

## Security notes

- API-key secrets are encrypted at rest with AES-256-GCM (`key_ciphertext`);
  the SHA-256 hash remains the auth lookup. Plaintext is returned only at
  creation and on explicit reveal — never stored or logged.
- Key rotation: set `API_KEY_ENCRYPTION_KEY_PREVIOUS` to the old key, swap
  `API_KEY_ENCRYPTION_KEY`, verify reveals still work, then drop the previous
  key.
- Token comparisons are constant-time. `/api/internal/*` accepts only
  `INTERNAL_TOKEN`, strictly isolated from public credentials.
- Empty `API_AUTH_TOKEN` closes every public route.

## Roadmap

See [`ROADMAP.md`](ROADMAP.md) for the feature checklist across the five
target phases (control plane, reliable events, WhatsApp API, production
platform, developer experience) with done / partial / missing status.

## Related docs

- `docs/README.md` — docs index
- `.opencode/plans/split-architecture.md` — architecture plan
- `HANDOFF.md` — worker handoff notes
- `services/worker/docs/api-mapping-webhook.md` — webhook payload mapping spec
