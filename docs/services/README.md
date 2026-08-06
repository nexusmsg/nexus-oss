# Services

Each service is documented under its own directory. Every directory has a
`README.md` that indexes its sections.

```text
services/
  api/       Node.js Hono API — WABA-compatible HTTP surface, job enqueue +
             synchronous result wait, session & webhook management, internal
             worker-facing routes
  worker/    Go + WhatsMeow gateway, split into two binaries sharing the
             whatsmeow_jobs queue — cmd/worker (stateless dispatcher:
             jobs -> whatsmeow_jobs) and cmd/whatsapp_worker (stateful
             executor: whatsmeow_jobs -> jobs write-back)
```

## Index

| Service | Stack | Entry point | Docs |
|---------|-------|-------------|------|
| [API](api/) | Node.js, Hono | `services/api/src/index.ts` | architecture, endpoints, configuration, testing |
| [Worker](worker/) | Go, WhatsMeow | `services/worker/cmd/worker` + `services/worker/cmd/whatsapp_worker` | architecture, device-manager, queue, configuration, testing |

## Interaction overview

```text
Client ──► API ──► PostgREST/Postgres (jobs)
              │
              └──(poll)──► cmd/worker dispatcher ──► whatsmeow_jobs
                                                         │
                                                         └──► cmd/whatsapp_worker executor ──► WhatsMeow
                                                                   │  (writes result back to jobs)
                                                                   ▼
                                                            jobs (succeeded/failed)
                                                                   │
                                                                   └──► API polls to terminal + reads result
WhatsApp ◄─────────────────────────────────────────────────────┘
   │
   └──► worker handler (whatsapp_worker) ──► webhook forwarder ──► customer endpoint
```
