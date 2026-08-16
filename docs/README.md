# Documentation — waba-api-unofficial

This is the **documentation graph** for the whole repository. Each level is a
navigation index; follow the links to drill into a service, then into a
specific section, and so on.

```text
docs/
  README.md            <- you are here (root index)
  architecture/        <- cross-cutting runtime flows & plans
  services/            <- per-service documentation (worker; the HTTP API
                          lives in apps/dashboard)
  shared/              <- shared assets (db migrations)
  apps/                <- UI & frontend (Nexus dashboard, hosts the API)
```

## Repository at a glance

Turborepo monorepo implementing an **unofficial WhatsApp Business API (WABA)
replicator** for local testing and prototyping without a live Business
account.

| Component | Path | Stack | Docs |
|-----------|------|-------|------|
| Dashboard (API + UI) | `apps/dashboard/` | Next.js 16, React 19, Drizzle/pg | [apps](apps/) |
| Worker | `services/worker/` | Go, WhatsMeow, pgx | [services/worker](services/worker/) |
| DB migrations | `shared/db/migrations/` | SQL, golang-migrate | [shared](shared/) |
| Architecture & flows | `docs/architecture/`, `docs/flow.md` | mermaid flows | [architecture](architecture/) |

## How to navigate

1. **Start here** — decide which component your question is about.
2. Open that component's index (`apps/README.md`, `services/worker/README.md`).
3. Follow the section links (architecture, endpoints, configuration, testing…).

## Working agreements

- Every plan/milestone that changes code **must include a docs update step**
  in this graph (see `AGENTS.md` → Planning and Milestones).
- Keep indexes shallow: each `README.md` only links to its own children or
  sections; content lives at the leaves.
- When you add a service, app, or major section, link it from this root index.
