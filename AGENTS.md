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

## Component-Level AGENTS.md

Each component area has its own nested rules file — check it before touching
that area:

- `services/api/AGENTS.md` — Hono API: hexagonal layout, route/auth
  conventions, PostgREST rules, `npm test` + integration gating.
- `services/worker/AGENTS.md` — Go worker (see above).
- `shared/AGENTS.md` — DB migrations: file conventions, idempotency, Docker
  rebuild requirement, doc sync.
- `apps/AGENTS.md` — frontend area (placeholder; conventions to be filled in
  once code lands).

## Plans and Docs

- Architecture plan: `.opencode/plans/split-architecture.md`
- Worker handoff: `HANDOFF.md`
- Webhook mapping spec: `services/worker/docs/api-mapping-webhook.md`
- Docs graph: `docs/README.md` is the root index; `docs/services/README.md`
  indexes the services, each service has its own section docs under
  `docs/services/<name>/`, plus `docs/shared/`, `docs/apps/`, and
  `docs/architecture/`.

## Planning and Milestones

- Break large plans into explicit milestones (M1, M2, ...) before writing any
  code. Each milestone must be independently verifiable and shippable; never
  implement a large plan in one pass.
- Work one milestone at a time: complete, verify, and close it before starting
  the next. New milestones are gated on the previous one's verification
  passing.
- Record milestone status in `.opencode/plans/split-architecture.md` (mark
  `(Completed)` and append verification evidence) and reference the milestone
  in commit messages, e.g. `feat: ... (M9)`.
- Every plan or milestone that changes code must include a documentation
  update: extend the matching section docs under `docs/` (routes, config,
  architecture, migrations, flows) in the same milestone, and keep the index
  links in `docs/README.md` / `docs/services/README.md` accurate.

## Handoff Logging

- Keep `HANDOFF.md` current as work progresses, not only at the end: update it
  whenever a milestone (or significant chunk) lands.
- Log what changed, what was verified (with evidence), open/blocked items, and
  the latest milestone/commit.
- Before finishing a session, refresh the handoff so the next agent can pick up
  without re-discovering context — including environment notes that bite later
  (e.g. migrations are baked into Docker images, so `docker compose build
  migrate` is required before `up -d` after new migration files).
