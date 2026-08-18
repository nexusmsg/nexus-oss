# Nexus OSS Roadmap

Feature priorities and implementation order derived from `oss-feature.md`.

## Priority Legend

- **P0** — Next up, blocking later work
- **P1** — High priority, follows P0
- **P2** — Planned, no immediate dependency
- **P3** — Deferred, low priority

---

## P0 — Observability + Retry Pipeline

> Observability is actively being worked on. Retry policy and retry queue follow
> immediately after, before media.

- [ ] Observability
  - [ ] Metrics (API, Message, Session)
  - [ ] Health endpoints (API, Database, Session)
  - [ ] Structured log aggregation (API, Session, Message)
- [ ] Webhooks — Retry Policy (configurable per-webhook, replace hardcoded backoff)
- [ ] Queue — Retry Queue (DLQ, configurable policy API)

## P1 — Media

> Media implementation starts after observability + retry are complete.

- [ ] Messaging — Media (upload/download, image/audio/video/document types)

## P2 — Planned

- [ ] Providers > WhatsApp — Reconnect (user-facing pause/resume API)
- [ ] Developer Platform
  - [ ] OpenAPI spec
  - [ ] Control-plane CLI
  - [ ] Auto-generated documentation
  - [ ] SDK
  - [ ] Examples
- [ ] Messaging — Delivery Status (outbound query API; inbound events already flow
  to webhooks; observability UI will cover status visibility)

## P3 — Deferred

- [ ] Providers > WhatsApp — Contacts (list/query/block)
- [ ] Providers > WhatsApp — Groups

---

## Notes

- **Reconnect:** Will expose a user-facing API to pause and resume a WhatsApp
  session connection. Implicit auto-reconnect on disconnect already exists in the
  worker.
- **Contacts & Groups:** Deferred to P3. No urgency — core messaging works
  without them.
- **Media:** Blocked on observability. Must ship observability first so media
  operations are observable from day one.
- **Delivery Status:** Inbound status events (delivered/read) already flow to
  webhooks. Outbound query endpoints deferred to P2. The observability UI
  (P0) will surface delivery visibility in the interim.
- **Retry Policy + Retry Queue:** DB schema exists; implementation wires up
  configurable backoff and DLQ. Ships right after observability.
