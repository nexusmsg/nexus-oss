# Apps Guidelines (apps)

## Project Overview

`apps/` is the UI/frontend area of the monorepo. Currently contains one app:

- **`apps/dashboard/`** — Nexus developer portal (Next.js 16 + Tailwind CSS v4)

## Dashboard App

- **Package**: `@waba/dashboard` (Next.js 16.3.0, React 19, TypeScript)
- **Styling**: Tailwind CSS v4 with design tokens via `@theme` in `globals.css`
- **Design source**: `design/dashboard/*.html` (9 Nexus dark theme screens)
- **Entry**: `src/app/layout.tsx` → `src/app/page.tsx` (playground/verification page)
- **Components**: `src/components/` — 19 components + icons + barrel export
- **Dev server**: `next dev -p 3002` (port 3002; 3000 = API, 3001 = PostgREST)
- **Font**: Inter + JetBrains Mono via `next/font/google`

## Conventions

- One app per subdirectory, each with its own `package.json` and workspace name `@waba/<name>`.
- Root scripts (`npm run dev` / `build` / `test` / `lint`) run every package
  through Turborepo — new apps must participate without breaking the pipeline.
- User-visible interfaces are owned by the @designer workflow; headless/state
  logic by @fixer. See root `AGENTS.md`.
- Icons: Do NOT add lucide-react. Hand-ported SVG set at `src/components/icons/index.tsx`.
