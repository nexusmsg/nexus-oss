# Roadmap — feature checklist

Status of the five target phases. ✅ = done, 🟡 = partial (note explains what
exists / what's missing), ❌ = not started. Updated 2026-08-14 against the
current codebase (dashboard API + Go worker; the archived Hono `services/api`
is removed).

## Checklist

**Phase 1 — Control Plane Foundation**

- [x] API Keys
- [x] Session
- [x] QR Login
- [x] Pairing Code
- [x] Connection Status
- [x] Logout
- [ ] Reconnect
- [ ] Workspace

**Phase 2 — Reliable Events**

- [x] Webhook endpoints
- [x] Event subscriptions
- [ ] Event model (partial — config + subscriptions exist; catalog/versioning not formalized)
- [ ] Signing
- [ ] Delivery (partial — worker forwards with retry/backoff)
- [ ] Retry (partial — forward + job retries exist; policy not configurable)
- [ ] Dead Letter
- [ ] Idempotency

**Phase 3 — WhatsApp API**

- [ ] Messaging (partial — engine + queue + executor work; no public route yet)
- [ ] Delivery Status (partial — inbound status events flow to webhooks)
- [ ] Contacts
- [ ] Groups
- [ ] Media

**Phase 4 — Production Platform**

- [x] Queue
- [ ] Metrics
- [ ] Logs (partial — structured logging; no aggregation/tracing)
- [ ] Health (partial — internal heartbeat; no public health endpoint)
- [ ] Usage
- [ ] Rate Limiting (partial — reveal limit only)

**Phase 5 — Developer Experience**

- [ ] OpenAPI
- [ ] REST API polish (partial — WABA envelopes + auth done; audit ongoing)
- [ ] SDK
- [ ] CLI (partial — worker migrate CLI only)
- [ ] Documentation (partial — `docs/services/api/**` stale, describes removed Hono API)
- [ ] Examples

## Status detail

### Phase 1 — Control Plane Foundation

| Feature | Status | Notes |
|---------|--------|-------|
| Workspace | ❌ | No workspace / multi-tenant concept — single-instance, bootstrap-token model. A "workspace" would be org-scoped isolation of keys, sessions, webhooks |
| API Keys | ✅ | CRUD (`/api/v1/api-keys`), scopes (`read`/`write`/`full`), expiry, revoke, encrypted at rest (AES-256-GCM), on-demand reveal (`/[serial]/secret`), key rotation, dashboard UI |
| Session | ✅ | List / create / get / delete (`/api/v1/sessions`) |
| QR Login | ✅ | `GET /sessions/[serial]/pairing/qr` — scan with the WhatsApp mobile app |
| Pairing Code | ✅ | `POST /sessions/[serial]/pairing` (job-based, async result) |
| Connection Status | ✅ | `GET /sessions/[serial]/status` |
| Reconnect | 🟡 | No dedicated reconnect endpoint; reconnection happens implicitly via re-pairing + the worker's session recovery/retry. A first-class `reconnect` job/endpoint is missing |
| Logout | ✅ | `POST /sessions/[serial]/logout` (job-based) |

### Phase 2 — Reliable Events

| Feature | Status | Notes |
|---------|--------|-------|
| Event model | 🟡 | Webhook config + per-event-type subscriptions exist; worker maps WhatsMeow events → WABA-shaped payloads (`services/worker/docs/api-mapping-webhook.md`). Event catalog/versioning not formalized |
| Webhook endpoints | ✅ | CRUD (`/api/v1/webhooks`), update, test-fire (`/[serial]/test`) |
| Event subscriptions | ✅ | Subscribe/unsubscribe per event type (`/[serial]/subscriptions[/[eventType]]`) |
| Signing | ❌ | No HMAC/SHA-256 signature header on delivered webhooks — receivers can't verify payloads came from this server |
| Delivery | 🟡 | Worker resolves the configured URL and forwards with retry/backoff; no delivery queue, no delivery receipts, no per-webhook backlog |
| Retry | 🟡 | Forward retries with delay exist (worker `message.go`); job-level `retry-later` for sends. Retry policy (max attempts, backoff, jitter) not surfaced/configured |
| Dead Letter | ❌ | No DLQ table — undeliverable payloads are dropped after retries |
| Idempotency | ❌ | No idempotency keys / event-ids on deliveries — replay-safe delivery isn't possible |

### Phase 3 — WhatsApp API

| Feature | Status | Notes |
|---------|--------|-------|
| Contacts | ❌ | No contacts endpoints (list/query/block) |
| Groups | ❌ | No groups endpoints |
| Messaging | 🟡 | Engine exists: send-message service → `jobs` queue → worker executor → device, with async wait (`SEND_TIMEOUT_MS`). The public send route (`POST /messages`) was in the archived Hono API and is **not wired in the current dashboard API** |
| Delivery Status | 🟡 | Inbound status events (delivered/read) flow to webhooks via the worker; no outbound status query endpoints |
| Media | ❌ | No media upload/download (`POST /<phone>/media`, media-by-id) |

### Phase 4 — Production Platform

| Feature | Status | Notes |
|---------|--------|-------|
| Queue | ✅ | Supabase `jobs` + `whatsmeow_jobs`, two-binary consumer (stateless dispatcher + stateful executor) |
| Metrics | ❌ | No Prometheus/metrics endpoints |
| Logs | 🟡 | Structured logging in the worker; audit lines for key reveal; no log aggregation/tracing (no Loki/Tempo/Pyroscope wiring) |
| Health | 🟡 | Internal heartbeat (`/api/internal/v1/heartbeat`, worker → API); no public health/readiness endpoint |
| Usage | ❌ | No per-key/account usage tracking (messages sent, webhooks delivered) |
| Rate Limiting | 🟡 | Per-serial reveal limit (10/5min) only; no general API or message-send rate limits |

### Phase 5 — Developer Experience

| Feature | Status | Notes |
|---------|--------|-------|
| OpenAPI | ❌ | No OpenAPI spec. Highest-leverage item — everything else (SDK, CLI, examples, docs accuracy) hangs off it |
| REST API polish | 🟡 | WABA-compatible error envelopes (`OAuthException`), constant-time auth, consistent status codes; surface audit + hardening ongoing |
| SDK | ❌ | No client SDK |
| CLI | 🟡 | Worker has a migrate CLI only; no API/control CLI |
| Documentation | 🟡 | Docs graph exists (`docs/README.md`); `docs/services/api/**` is stale (describes the removed Hono API) and needs rewriting against the dashboard API |
| Examples | ❌ | No runnable example integrations |

## Suggested order of attack

1. **OpenAPI spec** (Phase 5) — unblocks SDK, CLI, accurate docs, and lets the
   REST-polish work be verified against a contract.
2. **Event signing + idempotency** (Phase 2) — the biggest correctness gap for
   webhook consumers (verify origin, replay-safe).
3. **Public messaging route** (Phase 3) — the engine already works; exposing
   `POST /messages` completes the core WhatsApp API story.
4. **Public health + metrics** (Phase 4) — cheap and needed before any real
   deployment.
5. **Dead Letter + usage tracking** (Phases 2/4) — once delivery is reliable,
   capture what's dropped and who sent what.
6. **Workspace** (Phase 1) — the largest change (multi-tenancy); do last,
   informed by everything above.
