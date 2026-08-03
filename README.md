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
WABA_DEVICES — comma-separated phone_number_id:number pairs,
  e.g. WABA_DEVICES=1001:628123456789,1002:628987654321
```

Details, mapping rules, and handoff notes: `services/worker/HANDOFF.md`,
`services/worker/docs/api-mapping-webhook.md`, `services/worker/AGENTS.md`.

## API (Node.js Hono)

The API service lives in `services/api/` and is scaffolded. It will expose the
WABA-compatible send endpoint, enqueue jobs into Supabase, wait for the worker
result, and return the official WABA response shape (see the architecture
plan).

## License

[MIT](LICENSE)
