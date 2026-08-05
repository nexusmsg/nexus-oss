# Apps Guidelines (apps)

## Project Overview

`apps/` is the UI/frontend area of the monorepo. It is currently a
placeholder — only `.gitkeep` exists. No framework, build tooling, or
application code lives here yet.

## Status

- Do not add application code to `apps/` without a concrete feature request.
- When a frontend lands, it will consume the API surface under
  `../services/api/` (session management, QR pairing, webhook configs) —
  document the app and its API usage in `../../docs/apps/README.md`.

## Conventions (once code exists)

- One app per subdirectory (e.g. `apps/dashboard/`), each with its own
  `package.json` and workspace name `@waba/<name>`.
- Root scripts (`npm run dev` / `build` / `test` / `lint`) run every package
  through Turborepo — new apps must participate without breaking the pipeline.
- User-visible interfaces are owned by the @designer workflow; headless/state
  logic by @fixer. See root `AGENTS.md`.
