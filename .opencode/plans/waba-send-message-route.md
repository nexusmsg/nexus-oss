# WABA Send-Text-Message Route Implementation Plan

## Objective

Expose the missing WABA-compatible send-text-message HTTP endpoint in the
Next.js dashboard: `POST /api/waba/:version/:phone_number_id/messages`,
mirroring the official WhatsApp Business Platform (Cloud API) contract for
text messages, with API-version path validation that only accepts the
compatible version and defaults to `v26.0`.

## Context

The outbound send pipeline is fully built but **no HTTP route serves it**:

- `apps/dashboard/src/lib/api/domain/outbound-message.ts` — `parseOutboundMessage`
  validates a WABA text payload (`messaging_product`, `type`, `to`, `text.body`,
  optional `category`).
- `apps/dashboard/src/lib/api/ports/send-message.ts` + `service/send-message.ts` —
  `SendMessagePort.send({ phoneNumberId, payload, signal })` enqueues a job,
  polls until terminal, returns `{ status: "succeeded", wamid }` or
  `{ status: "failed", reason }`; throws `SendTimeoutError` / `RequestAbortedError`.
- `apps/dashboard/src/lib/api/compose.ts` wires `sendMessage` into
  `WiredServices`; `config.ts` documents the intended route
  (`POST /:phone_number_id/messages`, `API_AUTH_TOKEN` bearer).
- **Gap:** `apps/dashboard/src/app/api/` has only `sessions`, `webhooks`,
  `api-keys`, and `internal/v1/*` routes. There is **no messages route**, so
  the Bruno request `bruno/WABA/01-send-text-message.bru` (`POST /1001/messages`)
  404s. The send flow can only run via the queue/worker path, never over HTTP.

The send path is an unofficial emulation: dashboard → `jobs` table → worker
dispatcher → WhatsMeow → real `wamid` write-back → dashboard polls → response.
This route is the official-shaped front door to that pipeline.

## Official Reference (pulled from developers.facebook.com, 2026-08-14)

- Endpoint: `POST https://graph.facebook.com/v<VER>/<PHONE_NUMBER_ID>/messages`
- Headers: `Authorization: Bearer <access token>`, `Content-Type: application/json`
- Text payload: `{ messaging_product: "whatsapp", recipient_type: "individual",
  to, type: "text", text: { body, preview_url? }, context?: { message_id? } }`
- Success 200: `{ messaging_product, contacts: [{ input, wa_id }],
  messages: [{ id: <wamid> }] }`
- 200 means **accepted**, not delivered; delivery status arrives via webhooks.
- Errors: `{ error: { message, type, code, error_data?: { details } } }`

## Scope

### In scope

1. New pure domain module `api-version.ts` (constants + `parseApiVersion`).
2. New route `apps/dashboard/src/app/api/waba/[version]/[phoneNumberId]/messages/route.ts`.
3. Tests: unit (`api-version.test.ts`) + route (`route.test.ts`).
4. Update `bruno/WABA/01-send-text-message.bru` URL to the new path.
5. Sync the route-path comment in `apps/dashboard/src/lib/api/config.ts`.

### Out of scope (deferred, tracked here)

- Other message types (template, media, contacts, interactive, …).
- `recipient_type`, `text.preview_url`, `context.message_id` — currently
  dropped silently by `parseOutboundMessage`; adding them is a separate change.
- Idempotency-key wiring (port accepts `idempotencyKey`; route does not read it).
- 4096-character `text.body` limit enforcement.
- Async send mode (`202` + status endpoint) — sync poll is the current design.

## Contract

### Endpoint

```
POST /api/waba/v26.0/{phone_number_id}/messages
```

- `:version` — path param, validated (see below).
- `:phone_number_id` — the WABA phone-number ID string used as the device key
  (e.g. `1001`). Passed through to the send port; the worker resolves the
  session/device.

### Versioning

- `DEFAULT_API_VERSION = "v26.0"`; `SUPPORTED_API_VERSIONS = ["v26.0"]`
  (readonly, extensible array).
- `parseApiVersion(raw)`: trim + lowercase; must match `v<major>.<minor>`
  (`/^v\d+\.\d+$/`); must be in `SUPPORTED_API_VERSIONS`. Returns the
  normalized version or `null`.
- Unsupported or malformed version → 400 error envelope with
  `Unsupported API version '<raw>'. Supported versions: v26.0`.

### Auth

Reuse the existing authorizer exactly like other v1 routes:

- `authorizeApi(req, config.apiAuthToken, { requiredScope: "write",
  getPersistedKeys: () => composeServices(config).apiKeyAuth })`.
- Unauthorized → 401 `{ error: { message: "Invalid OAuth access token",
  type: "OAuthException", code: 401 } }`.
- Empty `API_AUTH_TOKEN` closes the route (server-auth behavior).

### Request body (validated by `parseOutboundMessage`)

| Field | Required | Notes |
|---|---|---|
| `messaging_product` | yes | must be `"whatsapp"` |
| `type` | yes | must be `"text"` |
| `to` | yes | non-empty string |
| `text.body` | yes | non-empty string |
| `category` | no | `utility` \| `authentication` \| `service` |

### Success response (200, official envelope)

```json
{
  "messaging_product": "whatsapp",
  "contacts": [{ "input": "<to>", "wa_id": "<to minus leading '+'>" }],
  "messages": [{ "id": "<wamid>" }]
}
```

`wa_id` = `to` with a single leading `+` stripped, per the official example
(`+16505551234` → `16505551234`).

### Error responses (WABA-shaped envelope `{ error: { message, type, code } }`)

| Case | HTTP | Envelope |
|---|---|---|
| Unsupported / malformed version | 400 | `Unsupported API version '<raw>'. Supported versions: v26.0` |
| Unparseable JSON body | 400 | `Invalid request body` |
| Validation failure (`ValidationError`) | 400 | `error.message` from the validator |
| Send failed (port `{ status: "failed", reason }`) | 500 | `message: "Message send failed"` + `error_data.details: <reason/last_error>` |
| Poll deadline (`SendTimeoutError`) | 504 | `Message send timed out` |
| Request aborted (`RequestAbortedError`) | 400 | `Request aborted` (client gone; rarely observable) |
| Unknown errors | — | rethrow (existing route convention) |

`type` is `"OAuthException"` in every envelope (existing codebase convention).

## Files

### New

- `apps/dashboard/src/lib/api/domain/api-version.ts`
- `apps/dashboard/src/app/api/waba/[version]/[phoneNumberId]/messages/route.ts`
- `apps/dashboard/src/lib/api/domain/api-version.test.ts`
- `apps/dashboard/src/app/api/waba/[version]/[phoneNumberId]/messages/route.test.ts`

### Modified

- `bruno/WABA/01-send-text-message.bru` — URL →
  `{{base_url}}/api/waba/v26.0/{{phone_number_id}}/messages`
- `apps/dashboard/src/lib/api/config.ts` — route-path comment only

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Response shape | Official Graph 200 envelope | WABA-compatible emulation; consumers swap in the official API. The port's internal `{status, wamid}` envelope stays inside the service layer. |
| Unsupported version | 400 (not 404) | Parameter validation failure of an existing route. Easy to change if 404 is preferred. |
| Poll deadline | 504 Gateway Timeout | Semantically a timeout; alternative is 500. |
| Send failure | 500 + `error_data.details` = last error | WABA error shape carries the underlying worker error as detail. |
| Version normalization | case-insensitive trim + `v<major>.<minor>` regex + allowlist | Strict allowlist (not semver range) keeps "only the compatible one" semantics. |

## Acceptance Criteria

1. `POST /api/waba/v26.0/1001/messages` with a valid text payload + Bearer
   token returns **200** with the official envelope containing the real wamid.
2. Unsupported version (`v27.0`), malformed version (`v26`), missing/wrong
   token, invalid JSON, and invalid payload each return the correct WABA error
   envelope and status.
3. Send failure surfaces the worker error as `error.error_data.details` (500).
4. Poll deadline returns 504.
5. New unit + route tests pass; all existing dashboard tests still pass.
6. `lint` and `build` (tsc) are green.
7. The Bruno send-message request targets `/api/waba/v26.0/...`.

## Verification

- `npx vitest run` in `apps/dashboard` (new + existing tests)
- `npm run lint` and `npm run build` in `apps/dashboard`
- Optional e2e: `curl -X POST http://localhost:3000/api/waba/v26.0/1001/messages`
  against the dev stack with a paired session; confirm 200 envelope + wamid,
  then a 500 with a worker error against an unpaired phone number.

## Verification Log

| Date | Command | Result |
| ---- | ------- | ------ |
| 2026-08-14 | `npx vitest run` (apps/dashboard) | New tests 11/11 pass (api-version + waba route). Full suite 447 pass / 9 fail — the 9 are pre-existing stale `client.test.ts`/`sessions.test.ts` assertions (`getApiBaseUrl()` hardcodes `""` for same-origin at `client.ts:12`; tests still expect `http://localhost:3000`). Unrelated to this change. |
| 2026-08-14 | `npm run lint` (apps/dashboard) | 0 errors, 14 pre-existing warnings (none in new files). |
| 2026-08-14 | `npm run build` (apps/dashboard) | Passed; route registered as `ƒ /api/waba/[version]/[phoneNumberId]/messages`. |
