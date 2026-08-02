# Repository Guidelines

## Project Overview

`waba-api-unofficial` is a Go application that translates events from the
`whatsmeow` WhatsApp client into WhatsApp Business API-compatible webhook
payloads and forwards them to a configured endpoint.

Use Go `1.26.3` and the module path
`github.com/afikrim/waba-api-unofficial`.

## Architecture

The repository follows a small layered architecture with ports and adapters:

```text
internal/core/domain/        Internal models, entities, and application data
internal/core/ports/         Interfaces/contracts for implementations
internal/service/            Implementations of service ports and business rules
internal/adapters/           Third-party and external-system implementations
  whatsmeow/                 WhatsApp client adapter and event translation
  webhook/                   HTTP webhook/API client adapter
internal/config/             Environment-based configuration
cmd/main.go                  Application composition root
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

Do not put WhatsApp-library types, HTTP concerns, or webhook serialization
logic in `internal/core/domain` or `internal/service` unless the existing
design is intentionally being changed.

## Implementation Conventions

- Keep one primary concept per file and use the directory name as the package
  name.
- Define interfaces in `internal/core/ports`; depend on interfaces from
  services and adapters rather than concrete implementations.
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

## Whatsmeow Adapter Rules

- `internal/adapters/whatsmeow/client.go` owns the `whatsmeow.Client`
  lifecycle: creation, connection, QR/login handling, and disconnection.
- `internal/adapters/whatsmeow/handler.go` is an anti-corruption layer. It
  type-switches raw `whatsmeow` events, unwraps them when needed, maps them to
  `domain.InboundEvent`, and delegates to `ports.MessageService`.
- Keep business rules and webhook payload construction out of the handler;
  those belong in `internal/service` and `internal/core/domain` respectively.
- Do not leak `whatsmeow` event types through core ports or domain structs.
- Preserve the callback shape required by `whatsmeow` when registering event
  handlers. Handler errors cannot be returned through the raw callback, so
  handle them consistently with the existing adapter behavior.

## Domain and Service Rules

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

## Adapters and Configuration

- `internal/adapters/webhook` owns JSON marshaling, HTTP request creation,
  content headers, optional `X-Hub-Signature-256` HMAC signing, response
  handling, and transport errors.
- The webhook adapter should receive a domain payload and must not know about
  `InboundEvent` or service internals.
- Configuration comes from environment variables through
  `internal/config.Load`; keep defaults in that package and do not read
  environment variables throughout business logic.
- Keep resource ownership explicit in `cmd/main.go`: construct dependencies,
  register handlers, connect external clients, and defer cleanup there.

## Testing and Verification

There are currently no repository test files. New behavior should add focused
`*_test.go` tests, especially for service mapping, ignored self-sent events,
nil dependency validation, HMAC signatures, and adapter error paths.

Before submitting changes, run the narrowest relevant checks and normally:

```bash
gofmt -w <changed-go-files>
go test ./...
go vet ./...
```

For dependency or module changes, also run `go mod tidy` and inspect the diff
to ensure only intended module files changed. Do not commit generated binaries,
database files, credentials, or `.opencode` index artifacts.

## Change Boundaries

- Prefer the smallest change that preserves the existing architecture.
- Avoid adding compatibility layers, frameworks, global state, retries, or
  abstractions without a concrete requirement.
- When changing a port or domain event, inspect every implementation and
  caller before editing; ports are the contract between independent layers.
- Update `README.md` when user-visible setup, configuration, or runtime
  behavior changes.
