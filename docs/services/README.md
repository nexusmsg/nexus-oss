# Services

Each service is documented under its own directory. Every directory has a
`README.md` that indexes its sections.

The HTTP API is hosted in the dashboard (`apps/dashboard/`, Next.js route
handlers under `/api/v1/*` and `/api/internal/*`); only the worker has its own
service directory here.

```text
services/
  worker/    Go + WhatsMeow gateway, split into two binaries sharing the
             whatsmeow_jobs queue — cmd/worker (stateless dispatcher:
             jobs -> whatsmeow_jobs) and cmd/whatsapp_worker (stateful
             executor: whatsmeow_jobs -> jobs write-back)
```

## Index

| Service | Stack | Entry point | Docs |
|---------|-------|-------------|------|
| [Worker](worker/) | Go, WhatsMeow | `services/worker/cmd/worker` + `services/worker/cmd/whatsapp_worker` | architecture, device-manager, queue, configuration, testing |

## Interaction overview

```text
Client ──► Dashboard API (Next.js, Drizzle) ──► Postgres (jobs)
              │
              └──(poll)──► cmd/worker dispatcher ──► whatsmeow_jobs
                                                          │
                                                          └──► cmd/whatsapp_worker executor ──► WhatsMeow
                                                                    │  (writes result back to jobs)
                                                                    ▼
                                                             jobs (succeeded/failed)
                                                                    │
                                                                    └──► Dashboard API polls to terminal + reads result
WhatsApp ◄─────────────────────────────────────────────────────┘
   │
   └──► worker handler (whatsapp_worker) ──► webhook forwarder ──► customer endpoint
```
