# Architecture — Cross-System Overview

How the three component areas interact, end to end.

Path: `docs/architecture/`

## Documents

| Document | Content |
|----------|---------|
| [flow.md](../flow.md) | Mermaid sequence diagrams: session creation, pairing job-driven, logout, heartbeat, send message |
| [oss-feature.md](../oss-feature.md) | Notes on the OSS-facing feature set |

## The big picture

```text
Client (WABA-compatible)
   │ POST /:phone_number_id/messages, /api/v1/sessions, /api/v1/webhooks
   ▼
services/api (Hono)          ──► PostgREST ──► Postgres (jobs, sessions,
   │  enqueue job, poll result                        webhook_configs, ...)
   │  GET /internal/v1/webhook-config (worker)
   ▼
services/worker (Go + WhatsMeow)
   │  queue consumer → executor → DeviceManager → WhatsMeow
   │  WhatsMeow events → WABA payload → webhook forwarder (HMAC)
   ▼
Customer webhook endpoint (inbound messages)
```

## Component map

| Component | Role | Docs |
|-----------|------|------|
| `services/api/` | WABA-compatible HTTP surface, job enqueue + sync wait, webhook-config API | [services/api](../services/api/README.md) |
| `services/worker/` | WhatsApp gateway: WhatsMeow ↔ webhooks, outbound send execution, queue consumer | [services/worker](../services/worker/README.md) |
| `shared/db/migrations/` | Shared SQL migrations (golang-migrate) | [shared](../shared/README.md) |
| `apps/` | UI/frontend (placeholder) | [apps](../apps/README.md) |

## Authority

- Worker mapping rules: `services/worker/docs/api-mapping-webhook.md`.
- Architecture plan + milestones: `.opencode/plans/split-architecture.md`.
- Worker handoff: `HANDOFF.md`.
