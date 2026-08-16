# waba-api-unofficial (Turborepo Monorepo)

> **DEPRECATION NOTICE (2026-08-07) — repo rules are deprecated; skills govern.**
> The prescriptive rules in this file and the component `AGENTS.md` files are
> deprecated. Judge architecture and test work against the user's skills
> (loaded from `~/.config/opencode/opencode-skills`) instead:
>
> - **Architecture / layering:** `hexagonal-architecture`
> - **Test discipline:** `unit-test`, `functional-test`, `integration-test`
> - **Workflow / planning / verification:** `deepwork`, `verification-planning`
>
> Sections below remain as **factual reference** (layout, commands, current
> state). Where a section states a *rule*, the rule is deprecated and the skill
> takes precedence.

This repository is a Turborepo monorepo with three component areas:

- `apps/dashboard/` — Next.js 16 app hosting the WABA-compatible HTTP API
  (`/api/v1/*`, `/api/internal/*`, Drizzle/pg) plus the management UI.
- `services/worker/` — Go + WhatsMeow message gateway: WhatsMeow events → WABA
  webhook payloads, outbound send execution, queue consumer (two binaries).
- `shared/db/migrations/` — SQL migrations in golang-migrate format (M2).

## Commands

- `npm install` at the repo root installs all workspace dependencies.
- `npm run dev` / `npm run build` / `npm run test` / `npm run lint` run the
  task in every package through Turborepo. The Go worker participates via its
  npm scripts (`go build`, `go run`, `go test`).

## Database Migration Workflow

- The tracked SQL files under `shared/db/migrations/` are the single source of
  truth for the database schema. Do not apply migrations from an untracked or
  locally generated directory.
- The `migrate` service in `docker-compose.yml` uses the worker image's
  `/app/migrations` directory. `services/worker/Dockerfile` copies the tracked
  `shared/db/migrations/` directory into that path at image build time.
- After adding or changing a migration, rebuild and run the migration service
  before starting dependent services:

  ```bash
  docker compose build migrate
  docker compose up -d migrate postgres
  ```

- Verify migration status through the `migrate` service or the worker migrate
  CLI; do not run SQL manually against the application database as a substitute
  for a tracked migration.

## Go Worker Rules (DEPRECATED)

> Deprecated rule section. Layering and test standards come from the skills:
> `hexagonal-architecture`, `unit-test`, `functional-test`, `integration-test`.

`services/worker/AGENTS.md` describes the current worker layout and contracts —
factual reference only; its prescriptive rules are deprecated. Run `gofmt`,
`go test ./...`, and `go vet ./...` from `services/worker/` before handoff as
ordinary hygiene, and choose test levels per the test skills.

## Component-Level AGENTS.md

Each component area has its own nested rules file — check it before touching
that area:

- `apps/AGENTS.md` — dashboard: Next.js conventions, API/UI layout, design
  system ownership.
- `services/worker/AGENTS.md` — Go worker (see above).
- `shared/AGENTS.md` — DB migrations: file conventions, idempotency, Docker
  rebuild requirement, doc sync.

## Plans and Docs

- Architecture plan: `.opencode/plans/split-architecture.md`
- Worker handoff: `HANDOFF.md`
- Webhook mapping spec: `services/worker/docs/api-mapping-webhook.md`
- Docs graph: `docs/README.md` is the root index; `docs/services/README.md`
  indexes the services, each service has its own section docs under
  `docs/services/<name>/`, plus `docs/shared/`, `docs/apps/`, and
  `docs/architecture/`.

## Planning and Milestones (DEPRECATED)

> Deprecated rule section. Planning, milestones, review gates, and progress
> tracking are governed by the `deepwork` skill; verification and evidence
> paths by `verification-planning`. `.opencode/plans/split-architecture.md`
> and `HANDOFF.md` remain as the historical working record.

## Handoff Logging (DEPRECATED)

> Deprecated rule section. Keeping the working record current is part of the
> `deepwork` workflow (persistent progress tracking) and `reflect`
> (retrospective); the mechanics of updating `HANDOFF.md` are repository
> convention, not governing rules.
