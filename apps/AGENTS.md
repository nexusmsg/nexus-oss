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
- **Dev server**: `next dev -p 3002` (port 3002; 3000 = API)
- **Font**: Inter + JetBrains Mono via `next/font/google`

## Conventions

- One app per subdirectory, each with its own `package.json` and workspace name `@waba/<name>`.
- Root scripts (`npm run dev` / `build` / `test` / `lint`) run every package
  through Turborepo — new apps must participate without breaking the pipeline.
- User-visible interfaces are owned by the @designer workflow; headless/state
  logic by @fixer. See root `AGENTS.md`.
- Icons: Do NOT add lucide-react. Hand-ported SVG set at `src/components/icons/index.tsx`.

### Route Handler Pattern

All public `/api/v1/*` and `/api/waba/*` routes are composed as nested
higher-order functions:

```ts
export const GET = authz({ scope: "read" })(
  time()(
    obs()(
      async (req, { params, activity }) => { /* handler body */ },
    ),
  ),
);
```

- `authz` (`src/lib/api/authz.ts`) is always the outermost layer: it builds the
  route context, authorizes, and returns the 401 envelope without calling any
  inner layer or composing services. Management routes pass `bootstrapOnly: true`.
- `time` (`src/lib/api/time.ts`) exposes `ctx.timing` for the recorded `duration_ms`.
- `obs` (`src/lib/api/observability-capture`) records one `api_request` activity
  row fire-and-forget; handlers report an enqueued job serial via
  `activity.setJobSerial(...)`. Use `captureResponse: false` on routes that
  return secrets (e.g. API-key reveal) and `resolvePath` to report a logical path.
- Error envelopes come from `src/lib/api/envelopes.ts`; do not inline auth,
  envelope, or activity logic in a route.
- Ordering guarantee: `authz` must wrap `obs` (not the reverse) or the
  unauthorized-request-records-nothing contract breaks.
