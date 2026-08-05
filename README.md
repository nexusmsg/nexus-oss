# waba-api-unofficial

Unofficial WABA (WhatsApp Business API) replicator — helps developers test and
prototype products that integrate with the official WhatsApp Cloud API without
needing a live Business account.

## Use Cases

- Local development and testing of WABA webhook handlers
- Proof-of-concept (POC) prototypes before WABA approval
- Load testing webhook ingestion pipelines
- Debugging webhook payload formats

## Architecture

Turborepo monorepo split into three component areas:

```text
apps/                     # UI & frontend (placeholder)
services/
  api/                    # Node.js Hono API — WABA-compatible HTTP surface,
                          # job enqueue + synchronous result wait, internal
                          # webhook-config API (in progress)
  worker/                 # Go + WhatsMeow message gateway — WhatsMeow events →
                          # WABA webhook payloads, outbound send execution
shared/
  db/migrations/          # SQL migrations, golang-migrate format (M2)
```

See `.opencode/plans/split-architecture.md` for the full architecture plan and
milestone tracker.

## Getting Started

```bash
# Install workspace dependencies (root)
npm install

# Run every package through Turborepo
npm run build
npm run test
npm run dev
```

## Worker (Go + WhatsMeow)

The worker lives in `services/worker/`. It receives WhatsMeow message events,
maps them into WhatsApp Business API-shaped webhook payloads, logs the final
JSON, and forwards them to the webhook endpoint resolved from the internal API.
It consumes outbound message jobs from the Supabase `jobs` queue and sends
them through the WhatsApp device registered for each job's phone number.

Run from `services/worker/`:

```bash
go run ./cmd
```

Worker configuration (env):

```text
BUSINESS_ACCOUNT_ID
SUPABASE_DSN
WHATSMEOW_STORE_DSN
MIGRATIONS_DIR
POLL_INTERVAL
MAX_ATTEMPTS
API_URL
INTERNAL_TOKEN
WEBHOOK_CONFIG_TTL
```
Devices are provisioned dynamically from the `sessions` table (the worker
boot-syncs a device per stored session and re-provisions on QR pairing); each
session's `business_account_id` overrides the global `BUSINESS_ACCOUNT_ID`
fallback.

Details, mapping rules, and handoff notes: `HANDOFF.md`,
`services/worker/docs/api-mapping-webhook.md`, `services/worker/AGENTS.md`.

## API (Node.js Hono)

The API service lives in `services/api/` — a WABA-compatible HTTP surface on
Hono, deployable on Vercel (`api/` directory entry, no listener in the Vercel
handler):

- `POST /:phone_number_id/messages` — bearer auth (`API_AUTH_TOKEN`), WABA
  validation (mirrors the worker's outbound rules), optional idempotency key
  (header wins over body), enqueues a `send_message` job, polls until the
  worker completes, returns the official WABA 200 envelope with the real
  `wamid`, or a WABA error envelope (504 on timeout).
- `GET /internal/webhook-config?phone_number_id=...` — worker-facing, bearer
  auth (`INTERNAL_TOKEN`), returns the customer webhook URL/secret used for
  inbound forwarding.

API configuration (env): `PORT`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `API_AUTH_TOKEN`, `INTERNAL_TOKEN`,
`SEND_TIMEOUT_MS`, `RESULT_POLL_MS`.

## Local End-to-End Test

1. `docker compose up --build -d` from the repo root (Postgres, PostgREST,
   migrations, API, worker).
2. Provision devices in the `sessions` table (via the API) and recreate the
   API + worker:
   ```bash
   docker compose up -d --force-recreate api worker
   ```
3. Link WhatsApp: watch the worker logs
   (`docker compose logs -f worker`) and scan the `QR code [628123456789]: ...`
   with WhatsApp → Linked devices. Wait until QR output stops (device
   connected).
4. Register a customer webhook destination so inbound messages forward:
   ```bash
   docker compose exec postgres psql -U postgres -d waba -c \
     "insert into webhook_configs (phone_number_id, webhook_url, webhook_secret) \
      values ('1001', 'http://host.docker.internal:8081/webhook', 'optional-secret');"
   ```
   Point `webhook_url` at any receiver you control (e.g., a local echo server
   on host port 8081).
5. Send an outbound text message:
   ```bash
   curl -X POST http://localhost:3000/1001/messages \
     -H 'Content-Type: application/json' \
     -d '{"messaging_product":"whatsapp","to":"628987654321","type":"text","text":{"body":"hello from waba-api"}}'
   ```
   Expect 200 with `messages[].id` = the real `wamid`. Message that number to
   see the inbound payload forwarded to your webhook with
   `X-Hub-Signature-256` HMAC.

## License

[MIT](LICENSE)
