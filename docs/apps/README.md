# Apps — Frontend

The UI/frontend area of the monorepo. One app per subdirectory, each a
workspace named `@waba/<name>` participating in the root turbo pipeline
(`build`/`dev`/`test`/`lint`).

Path: `apps/`

## Apps

### Dashboard — `apps/dashboard/` (`@waba/dashboard`)

The **Nexus developer portal**: Next.js 16 + Tailwind CSS v4 dark dashboard app.
Serves as the admin surface for WhatsApp device sessions (QR pairing), webhook
configs, and API keys.

- **Framework**: Next.js 16.3.0 (App Router, Turbopack)
- **Styling**: Tailwind CSS v4.3.3 with design tokens via `@theme` in `globals.css`
- **Design source**: `design/dashboard/*.html` (9 Nexus dark theme screens, identical `:root` token block)
- **Entry**: `src/app/layout.tsx` → `src/app/page.tsx` (playground/verification page)
- **Components**: `src/components/` — 19 components + icons + barrel export
- **Fonts**: Inter + JetBrains Mono via `next/font/google`
- **Dev server**: `next dev -p 3002` (port 3002; 3000 = API)
- **Icons**: Hand-ported SVG set at `src/components/icons/index.tsx` (do NOT add lucide-react)

#### Design Tokens

All tokens defined in `src/app/globals.css` via `@theme` block:

- **Colors**: canvas (#0c0d0e), surface (#15171a), elevated (#1a1d21), hover (#1e2126), fg (#e8eaed), muted (#7a7e85), line (#262a2f), accent/success (#34d399), info (#60a5fa), warning (#fbbf24), danger (#f87171)
- **Typography**: 8-step scale (10-28px, base 13px), weights 400/500/600/700, tracking tight/wide/wider
- **Radius**: sm (4px), md (6px), lg (10px), pill (20px), full (50%)
- **Motion**: durations fast/normal/slow, pulse keyframe, default easing
- **Layout**: sidebar 240px, topbar 56px, content padding 24px

#### Component Library

19 components in `src/components/`:

- **Primitives**: Button, Badge, StatusDot, Avatar, Toggle, Tooltip
- **Layout**: Card, Sidebar, Topbar, Modal
- **Data**: Table, StatCard, DeviceStatus, APIKeyRow, ExpandableRow
- **Forms**: FormGroup, FormLabel, FormInput, FormSelect, FormHint, PasswordStrength
- **Feedback**: Alert, EmptyState, QuickActions

#### Playground Page

Single `/` route serves as verification surface for all components:

- 13 card sections covering all components in all states
- Interactive demos: modal open/close, toggle, API key reveal/copy, expandable rows, form validation, password strength
- App shell with Sidebar + Topbar for realistic context

#### Current Status

- Phases 1-5 complete: scaffold, tokens, components, playground, verification
- Build + lint pass across the monorepo (turbo)
- Verified no horizontal overflow at 360/480/768/1440/1920 viewports
- Token audit vs design `:root` block: all core tokens match
- Next: screens phase (dashboard, sessions, webhooks, api-keys, jobs, settings)
