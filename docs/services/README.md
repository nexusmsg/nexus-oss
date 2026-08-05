# Services

Each service is documented under its own directory. Every directory has a
`README.md` that indexes its sections.

```text
services/
  api/       Node.js Hono API — WABA-compatible HTTP surface, job enqueue +
             synchronous result wait, session & webhook management, internal
             worker-facing routes
  worker/    Go + WhatsMeow gateway — WhatsMeow events → WABA webhook payloads,
             outbound send execution, Supabase queue consumer, device manager
```

## Index

| Service | Stack | Entry point | Docs |
|---------|-------|-------------|------|
| [API](api/) | Node.js, Hono | `services/api/src/index.ts` | architecture, endpoints, configuration, testing |
| [Worker](worker/) | Go, WhatsMeow | `services/worker/cmd/main.go` | architecture, device-manager, queue, configuration, testing |

## Interaction overview

```text
Client ──► API ──► PostgREST/Postgres (jobs)
              │
              └──(poll)──► worker queue consumer ──► executor ──► WhatsMeow
                                                              │
WhatsApp ◄─────────────────────────────────────────────────────┘
   │
   └──► worker handler ──► webhook forwarder ──► customer endpoint
```
