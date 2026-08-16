# Plan: Refactor `withApiActivity` → Nested Middleware Composition (`authz(time(obs(handler)))`)

## Objective

Replace the monolithic `apps/dashboard/src/lib/api/observability-capture.ts` (346 lines, `withApiActivity` wrapper mixing auth, timing, body capture, redaction, row building, and recording) with **nested higher-order function composition**. Each concern becomes a small, standalone `(handler) => handler` factory; leaf logic (row building, redaction, body reading) becomes pure, independently unit-tested modules. Behavior and DB writes are **unchanged**.

## Context (files to know)

- Current wrapper: `apps/dashboard/src/lib/api/observability-capture.ts`
- Its contract tests: `apps/dashboard/src/lib/api/observability-capture.test.ts`
- Auth logic (do NOT duplicate — reuse): `apps/dashboard/src/lib/api/server-auth.ts` → `authorizeApiWithIdentity(req, token, { requiredScope, getPersistedKeys })` returns `{ authorized, identity }` where `identity` is api-key serial | `"bootstrap"` | `null`
- Row insert path (do NOT change): `ObservabilityService.record(row)` (`service/observability.ts`) → `DrizzleTransport.insert` (`adapters/db/index.ts`) → `activity_events`
- Row types: `ActivityInsertRow` (`ports/activity-transport.ts`), `ActivityContext` (`domain/observability.ts`)
- Composition root: `composeServices(config).observability` + `.apiKeyAuth` (`compose.ts`)

## Architecture

### Core types — new `apps/dashboard/src/lib/api/handler.ts`

```ts
import type { NextRequest, NextResponse } from "next/server";
import type { ActivityContext } from "./domain/observability";

export interface RouteContext {
  params: any;                    // Next passes Promise<Params>; routes `await params` (same as today)
  identity: string | null;        // set by authz
  requestSerial: string | null;   // alias of identity; what the row stores
  activity: ActivityContext;      // created by obs (setJobSerial contract)
  timing?: { elapsed(): number }; // started by time(), consumed by obs
}

export type RouteHandler = (req: NextRequest, ctx: RouteContext) => Promise<NextResponse>;
export type ApiMiddleware = (handler: RouteHandler) => RouteHandler;
```

### Factories

**`authz.ts`** — outermost. Creates the `RouteContext`, authorizes, 401 short-circuits *without calling inner* (→ no record, no `composeServices` beyond the auth port). `bootstrapOnly` routes omit `getPersistedKeys`.

```ts
export function authz(options: { scope: "read" | "write"; bootstrapOnly?: boolean }): ApiMiddleware {
  return (handler) => async (req, routeCtx) => {
    const config = loadConfig();
    const ctx: RouteContext = {
      params: routeCtx?.params,
      identity: null, requestSerial: null,
      activity: undefined as never,           // populated by obs
    };
    const auth = await authorizeApiWithIdentity(req, config.apiAuthToken, {
      requiredScope: options.scope,
      getPersistedKeys: options.bootstrapOnly
        ? undefined
        : () => composeServices(config).apiKeyAuth,
    });
    if (!auth.authorized) return unauthorized();   // from envelopes.ts
    ctx.identity = ctx.requestSerial = auth.identity;
    return handler(req, ctx);
  };
}
```

**`time.ts`** — exposes a timer on the context.

```ts
export function time(): ApiMiddleware {
  return (handler) => async (req, ctx) => {
    const start = Date.now();
    ctx.timing = { elapsed: () => Date.now() - start };
    return handler(req, ctx);
  };
}
```

**`obs.ts`** (in `observability-capture/`) — innermost. Creates `activity` ctx, runs handler, fires the row fire-and-forget; on throw records an `error` row (500) then rethrows.

```ts
export function obs(options: { resolvePath?: (req) => string; captureResponse?: boolean }): ApiMiddleware {
  return (handler) => async (req, ctx) => {
    ctx.activity = makeActivityContext();
    const start = Date.now();
    try {
      const res = await handler(req, ctx);
      void record({ req, res, ctx, options, start });       // never awaited, .catch(log)
      return res;
    } catch (err) {
      const errorRes = internalError();                      // from envelopes.ts
      void record({ req, res: errorRes, ctx, options, start, error: summarizeError(err) });
      throw err;
    }
  };
}
```

`record.ts` = port of current `recordRequest`: reads bodies via `read-body.ts` (`req.clone()` / `res.clone()`, never consume live streams), redacts via `redact.ts`, builds row via pure `build-row.ts`, resolves service `getObservability ?? composeServices(config).observability`, and calls `void observability.record(row).catch(log)` inside its own try/catch (composition failure also swallowed). Duration from `ctx.timing?.elapsed() ?? Date.now() - start`.

`build-row.ts` = pure `buildApiRequestRow({ method, path, status, durationMs, requestSerial, jobSerial, phoneNumberId, businessAccountId, requestBody, responseBody, error }) => ActivityInsertRow` — **no Next.js imports**, fully unit-testable. `summarizeError` → move to `errors.ts` (or fold into `record.ts`).

### Route usage (target form)

```ts
export const POST = authz({ scope: "write" })(
  time()(
    obs({ resolvePath: () => "/api/waba/:version/:phone_number_id/messages" })(
      async (req, { params, activity }) => { /* unchanged body */ },
    ),
  ),
);
```

Handler bodies and their `{ params, activity }` destructuring are **unchanged**. Only the export line changes.

## Change inventory

**Create (11 files, all under `apps/dashboard/src/lib/api/`):**
1. `handler.ts` — types
2. `authz.ts`
3. `time.ts`
4. `envelopes.ts` — `errorEnvelope(message, code, details?)`, `unauthorized()` (401 `"Invalid OAuth access token"`), `internalError()` (500) — **byte-identical JSON to current inline objects**
5. `observability-capture/index.ts` — re-export `obs`
6. `observability-capture/obs.ts`
7. `observability-capture/context.ts` — `makeActivityContext` (move from current file)
8. `observability-capture/read-body.ts`
9. `observability-capture/redact.ts`
10. `observability-capture/build-row.ts`
11. `observability-capture/record.ts`

**Delete (1):** `apps/dashboard/src/lib/api/observability-capture.ts`

**Modify — 15 route files** (wrapper export line only; import changes to `import { authz } from "@/lib/api/authz"`, `import { time } from "@/lib/api/time"`, `import { obs } from "@/lib/api/observability-capture"`):

| Route file | Exports → `authz({ scope, ... })` | obs options |
|---|---|---|
| `api/waba/[version]/[phoneNumberId]/messages/route.ts` | POST → write | `resolvePath: () => "/api/waba/:version/:phone_number_id/messages"`; uses `activity.setJobSerial(result.jobSerial)` |
| `api/v1/sessions/route.ts` | GET read; POST write | — |
| `api/v1/sessions/[serial]/route.ts` | GET read; PATCH write | — |
| `api/v1/sessions/[serial]/status/route.ts` | GET read | — |
| `api/v1/sessions/[serial]/logout/route.ts` | POST write | — |
| `api/v1/sessions/[serial]/pairing/route.ts` | POST write | — |
| `api/v1/sessions/[serial]/pairing/qr/route.ts` | GET read | — |
| `api/v1/webhooks/route.ts` | GET read; POST write | — |
| `api/v1/webhooks/[serial]/route.ts` | GET read; PATCH write; DELETE write | — |
| `api/v1/webhooks/[serial]/subscriptions/route.ts` | GET read; POST write | — |
| `api/v1/webhooks/[serial]/subscriptions/[eventType]/route.ts` | DELETE write | — |
| `api/v1/webhooks/[serial]/test/route.ts` | POST write | — |
| `api/v1/api-keys/route.ts` | GET read + `bootstrapOnly: true`; POST write + `bootstrapOnly: true` | — |
| `api/v1/api-keys/[serial]/route.ts` | GET read; PATCH write; DELETE write — all `bootstrapOnly: true` | — |
| `api/v1/api-keys/[serial]/secret/route.ts` | GET write + `bootstrapOnly: true` | `captureResponse: false` |

**Tests — modify/delete:**
- Replace `observability-capture.test.ts` → `authz.test.ts` + `obs.test.ts` preserving all 5 contract cases (mock `@/lib/api/compose` and `@/lib/api/config` as the current file does):
  1. bootstrap identity → `api_request` row, `request_serial: "bootstrap"`, status, `duration_ms ≥ 0`
  2. `setJobSerial` correlation
  3. 401 → no record, no `composeServices`
  4. R5: transport throws → normal envelope/status preserved, no row
  5. bodies captured + `Authorization` header redacted
- **New:** `build-row.test.ts` (pure row builder), `redact.test.ts`, `envelopes.test.ts`
- **Untouched:** every existing route test suite (route-auth, messages, api-keys, webhooks, observability) — must stay green (envelope output is byte-identical).

**Modify — `apps/AGENTS.md` (repo convention: component rules file must document the API-route pattern):**
- Replace/update the `## Conventions` section with a **Route Handler Pattern** entry: all public `/api/v1/*` and `/api/waba/*` routes are composed as nested higher-order functions
  `authz({ scope, bootstrapOnly })(time()(obs({ resolvePath, captureResponse })(handler)))` —
  auth always outermost (401 short-circuits before any inner layer), `time` exposes `ctx.timing`,
  `obs` records one `api_request` activity row fire-and-forget; error envelopes come from
  `src/lib/api/envelopes.ts`; do not inline auth/envelope/activity logic in a route.
- Note the ordering guarantee: `authz` must run before `obs` or the 401-no-record contract breaks.

## Implementation order

1. `handler.ts` + `envelopes.ts` (types & envelope helpers)
2. Leaf modules: `read-body.ts`, `redact.ts`, `build-row.ts`, `context.ts`, `record.ts` (+ `errors.ts` if used)
3. `time.ts`, `obs.ts`, `authz.ts`
4. Migrate 15 route files (mechanical wrapper-line swap)
5. Delete `observability-capture.ts`; replace contract tests + add unit tests
6. Update `apps/AGENTS.md` conventions with the nested-composition route pattern (see inventory)
7. Verify (below)

## Definition of done / verification

- `npm run test` (Turborepo: dashboard + worker suites) — all green
- `npm run lint`
- `npm run build` (dashboard typecheck via `next build`)
- `grep -r "withApiActivity" apps/dashboard` → zero matches
- All existing route tests unchanged and passing
- `apps/AGENTS.md` documents the `authz(time(obs(handler)))` route convention

## Out of scope (do NOT touch)

- `services/worker/` (Go), DB migrations/schema, `shared/db/schema.ts`
- `ports/activity-transport.ts`, `service/observability.ts`, `domain/observability.ts`, `compose.ts`, `adapters/db/index.ts` — the record path is untouched
- `/api/internal/*` routes (own `authorizeInternal`)
- `api/v1/observability/**` routes (inline `authorizeApi`, never wrapped) — optional follow-up to adopt `authz({ scope: "read", bootstrapOnly: true })` with zero inner layers
- No `compose()` helper unless nesting grows past 3 layers

## Risks / notes for the executing agent

- `RouteContext.params` is `any` to preserve today's `await params` behavior in handlers — do not over-type it.
- `time` and `obs` are collaborators: `time` only exposes `ctx.timing.elapsed()`; `obs` consumes it (`ctx.timing?.elapsed() ?? Date.now() - start`). If the coupling feels thin, folding `time` into `obs` is a one-line change.
- 401 envelope must come from `envelopes.ts`, and must NOT compose services — verify no `composeServices` call in the 401 branch.
- The `log` sink (recorder failure logger) and `captureResponse`/`resolvePath` defaults must be preserved in `obs`/`record`.
