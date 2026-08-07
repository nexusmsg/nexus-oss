# Repository Guidelines

> **DEPRECATION NOTICE (2026-08-07) — repo rules are deprecated; skills govern.**
> The prescriptive rules in this file are deprecated. Judge architecture and
> tests against the user's skills (loaded from
> `~/.config/opencode/opencode-skills`) instead:
>
> - **Architecture / layering:** `hexagonal-architecture`
> - **Test discipline:** `unit-test`, `functional-test`, `integration-test`
>
> Sections below marked **(DEPRECATED)** are historical rule sections; unmarked
> sections are factual reference for the current layout and contracts.

## Project Overview

`waba-api-unofficial` is a Go application that translates events from the
`whatsmeow` WhatsApp client into WhatsApp Business API-compatible webhook
payloads and forwards them to a configured endpoint.

Use Go `1.26.3` and the module path
`github.com/afikrim/waba-api-unofficial`.

## Architecture (DEPRECATED)

> Deprecated rule section — the *layout* below is factual reference, but the
> dependency-direction bullets are superseded by the `hexagonal-architecture`
> skill (entity/domain isolation, thin adapters with dto+mappers, handler
> layer).

The repository follows a small layered architecture with ports and adapters:

```text
internal/core/entity/        Internal models, entities, and application data
internal/core/ports/         Interfaces/contracts for implementations
internal/service/            Implementations of service ports and business rules
internal/adapters/           Third-party and external-system implementations
  whatsmeow/                 WhatsApp client adapter and event translation
  webhook/                   HTTP webhook/API client adapter
internal/config/             Environment-based configuration
cmd/worker/                  Stateless dispatcher composition root (jobs -> whatsmeow_jobs)
cmd/whatsapp_worker/         Stateful executor composition root (whatsmeow_jobs -> jobs write-back)
cmd/migrate/                 golang-migrate runner
```

Keep dependency direction one-way:

- `domain` contains the internal model used by the application. It must not
  depend on adapters, services, or external frameworks.
- `ports` defines interfaces for capabilities the application needs. It may
  depend on `domain` only.
- `service` implements service-related ports and contains application use
  cases and business rules. It may depend on `domain` and `ports`.
- `adapters` implements ports for third-party or external systems such as
  `whatsmeow`, PostgreSQL, SQLite, and HTTP API clients. It may depend on
  `domain`, `ports`, and the relevant external library.
- `cmd` is responsible for composition: loading configuration, constructing
  concrete adapters and services, registering handlers, and managing resource
  ownership.

## Two-Binary Split

The worker area ships two binaries that communicate only through the
`whatsmeow_jobs` table in Postgres. The API is untouched and still polls the
`jobs` table for terminal status + `result.wa_message_id`.

- **`cmd/worker` — stateless dispatcher.** Polls `jobs`, validates the job
  (send_message payloads), and INSERTs it into `whatsmeow_jobs` with
  `source_job_serial` = the original `jobs.serial`. Returns the sentinel
  `ports.ErrDispatched` so the consumer leaves the `jobs` row `claimed`.
  Must **not** import `internal/adapters/whatsmeow` or write to `sessions` /
  `session_qr_codes` (read-only session lookups are allowed but must be
  documented as read-only). Horizontally scalable.
- **`cmd/whatsapp_worker` — stateful executor.** Owns the `DeviceManager`,
  WhatsMeow clients, session store, and heartbeat. Polls `whatsmeow_jobs`,
  executes each job, and writes the terminal status + `result` (wamid) back to
  the originating `jobs` row via `source_job_serial`. Single-instance for now.
- **Sentinel contract.** A handler that returns `ports.ErrDispatched` tells the
  consumer to skip Complete/Retry/Fail and leave the row `claimed`.
- **Write-back contract.** On success the executor calls
  `jobsStore.Complete(source_job_serial, result)`; on a terminal failure
  (attempts >= max_attempts — the same condition the consumer uses to fail a
  row) it calls `jobsStore.Fail(source_job_serial, err)`. Retryable whatsmeow
  failures leave `jobs` `claimed`. `jobs` must not reach `succeeded` until the
  send actually finished.

Do not put WhatsApp-library types, HTTP concerns, or webhook serialization
logic in `internal/core/entity` or `internal/service` unless the existing
design is intentionally being changed.

## Implementation Conventions (DEPRECATED)

> Deprecated rule section — conventions follow the `hexagonal-architecture`
> skill (ports in `internal/core/ports`, thin adapters with dto/mapper, no
> tests on adapters/handlers). `gofmt` and error wrapping remain ordinary Go
> hygiene.

- Keep one primary concept per file and use the directory name as the package
  name.
- Define interfaces in `internal/core/ports`; depend on interfaces from
  services and adapters rather than concrete implementations.
- **Ports vs. concrete adapters — the send/receive rule.** An adapter gets a
  port only for the side that is *consumed by business logic*:
  - **Send / dispatch side** (producers push messages or commands *into* the
    adapter) → define a port in `internal/core/ports/`. Business logic depends
    on the port so it can dispatch without knowing the concrete transport.
    Example: `ports.ChannelDispatcher` is the send side of the channel router.
  - **Receive / handler side** (handlers *receive from* the adapter) → no
    port. It is concrete, like an HTTP handler. Example: `channel.Handler` and
    the `channel.Router`/`channel.Channel` structs live in
    `internal/adapters/channel/` and are not exposed through a port.
  - Presentation/transport-facing adapters (HTTP, WebSocket, the channel
    router itself) therefore have no port on their receive side; adapters
    consumed by business logic (repositories, send-side dispatchers) do.
- Use constructors named `New<Type>` that return the concrete type, for
  example `NewMessage` or `NewClient`.
- Add a compile-time interface assertion for each implementation:
  `var _ ports.Interface = (*ConcreteType)(nil)`.
- Keep dependencies private on structs and inject them through constructors.
- Prefer early validation and early returns for invalid nil dependencies or
  input values.
- Wrap errors with operation context using `fmt.Errorf("...: %w", err)`.
- Preserve the standard library as the default; use an external dependency
  only when it is already part of the application or clearly required.
- Run `gofmt` on every changed Go file. Keep comments short and explain why,
  not what obvious code does.

## Whatsmeow Adapter Rules (DEPRECATED)

> Deprecated rule section — per the `hexagonal-architecture` skill, the
> whatsmeow adapter should be thin glue (driver call + delegate to pure
> functions), and event translation logic belongs in pure, unit-testable
> mappers.

- `internal/adapters/whatsmeow/client.go` owns the `whatsmeow.Client`
  lifecycle: creation, connection, QR/login handling, and disconnection.
- `internal/handlers/whatsapp/handler.go` is an anti-corruption layer. It
  type-switches raw `whatsmeow` events, unwraps them when needed, maps them to
  `entity.InboundEvent`, and delegates to `ports.MessageService`.
- Keep business rules and webhook payload construction out of the handler;
  those belong in `internal/service` and `internal/core/entity` respectively.
- Do not leak `whatsmeow` event types through core ports or domain structs.
- Preserve the callback shape required by `whatsmeow` when registering event
  handlers. Handler errors cannot be returned through the raw callback, so
  handle them consistently with the existing adapter behavior.

## Domain and Service Rules (DEPRECATED)

> Deprecated rule section — domain isolation follows `hexagonal-architecture`;
> service behavior is verified per `functional-test` (ports mocked, offline).

- Domain structs represent the internal event model and the outgoing WABA
  payload model. Keep external JSON tags on webhook payload types.
- Add message/event kinds as typed constants such as
  `domain.MessageEventTypeText`; avoid scattering raw type strings across the
  codebase.
- `MessageService.Inbound` is the application boundary for inbound messages.
  It validates input, applies inbound-message rules such as ignoring self-
  sent events, maps the event to `domain.WebhookPayload`, and calls the
  injected `ports.WebhookForwarder`.
- Keep unsupported message content nil/omitted in the outgoing payload rather
  than inventing a text representation.
- Keep payload mapping deterministic and explicit. Do not couple it to the
  HTTP adapter.

## Adapters and Configuration (DEPRECATED)

> Deprecated rule section — adapter and config shape follows the
> `hexagonal-architecture` skill (thin adapters owning dto models; config via
> the skill's godotenv + caarlos0/env pattern).

- `internal/adapters/webhook` owns JSON marshaling, HTTP request creation,
  content headers, optional `X-Hub-Signature-256` HMAC signing, response
  handling, and transport errors.
- The webhook adapter should receive a domain payload and must not know about
  `InboundEvent` or service internals.
- Configuration comes from environment variables through
  `internal/config.Load`; keep defaults in that package and do not read
  environment variables throughout business logic.
- Keep resource ownership explicit in the `cmd/` entrypoints: construct
  dependencies, register handlers, connect external clients, and defer cleanup
  there.

## Testing and Verification (DEPRECATED)

> Deprecated rule section — the test pyramid comes from the `unit-test` /
> `functional-test` / `integration-test` skills (pure-function unit tests,
> service-level functional tests with mocked ports, and integration tests with
> mocked infra per the integration-test skill). Ordinary hygiene before
> handoff: `gofmt -l .`, `go vet ./...`, `go test ./...`.

## Change Boundaries (DEPRECATED)

> Deprecated rule section — YAGNI / complexity reduction is governed by the
> `simplify` skill; scope and review gates by `deepwork`.
