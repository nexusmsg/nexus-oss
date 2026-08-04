# waba-api-unofficial (Turborepo Monorepo)

This repository is a Turborepo monorepo with three component areas:

- `apps/` — UI & frontend (placeholder for now; `.gitkeep` only).
- `services/api/` — Node.js Hono API: WABA-compatible HTTP surface, job
  enqueue, synchronous result wait, internal webhook-config API.
- `services/worker/` — Go + WhatsMeow message gateway: WhatsMeow events → WABA
  webhook payloads, outbound send execution, Supabase queue consumer.
- `shared/db/migrations/` — SQL migrations in golang-migrate format (M2).

## Commands

- `npm install` at the repo root installs all workspace dependencies.
- `npm run dev` / `npm run build` / `npm run test` / `npm run lint` run the
  task in every package through Turborepo. The Go worker participates via its
  npm scripts (`go build`, `go run`, `go test`).

## Go Worker Rules

For anything inside `services/worker/`, follow `services/worker/AGENTS.md`: it
defines the layered architecture (domain → ports → service → adapters), the
WhatsMeow → WABA mapping rules, and the verification requirements. Run
`gofmt`, `go test ./...`, and `go vet ./...` from `services/worker/` before
handoff.

## Plans and Docs

- Architecture plan: `.opencode/plans/split-architecture.md`
- Worker handoff: `HANDOFF.md`
- Webhook mapping spec: `services/worker/docs/api-mapping-webhook.md`
