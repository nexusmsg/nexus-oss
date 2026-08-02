# WABA Webhook Mapping Implementation Plan

## Current Status

- Overall status: Completed for the logging-only scope
- Current milestone: Milestone 5 completed
- Logging-only mode: Confirmed
- Webhook forwarding: Deferred
- Media download flow: Deferred

## Scope

Translate inbound `whatsmeow` message events into payloads matching the WhatsApp Business API webhook shape, then log the final JSON payload from `internal/service/message.go`.

This phase does not send HTTP webhooks and does not implement media download endpoints.

## Milestones

### Milestone 0: Baseline Analysis

Status: Completed

- [x] Read `docs/api-mapping-webhook.md`.
- [x] Inspect the WhatsMeow adapter, domain, ports, service, configuration, and composition root.
- [x] Identify incorrect current mappings.
- [x] Confirm logging-only behavior for this phase.
- [x] Choose this file as the implementation progress tracker.

### Milestone 1: Configuration and Minimal Domain Model

Status: Completed

- [x] Add `BusinessAccountID` to configuration.
- [x] Source `entry[].id` from `BusinessAccountID`.
- [x] Source phone metadata from gateway configuration.
- [x] Add typed event constants for text, location, reaction, interactive, and unsupported messages.
- [x] Expand `domain.MessageEvent` with data required by the unambiguous in-scope message types.
- [x] Expand WABA domain models for location, reaction, interactive, and context payloads.
- [x] Keep domain types independent of WhatsMeow types.
- [x] Add `omitempty` to optional WABA fields.

Acceptance criteria:

- Domain packages do not import WhatsMeow or HTTP packages.
- The WABA model can represent every mapping documented in `docs/api-mapping-webhook.md`.
- Unsupported data is omitted instead of represented as invented text.

### Milestone 2: WhatsMeow Protobuf Truth Table and Event Mapping

Status: Completed

- [x] Refactor `internal/adapters/whatsmeow/handler.go` to unwrap raw messages.
- [x] Map sender from `evt.Info.Sender.User`.
- [x] Map message ID from `evt.Info.ID`.
- [x] Map timestamp as a Unix timestamp string.
- [x] Map profile name from `evt.Info.PushName`.
- [x] Detect conversation and extended text messages.
- [x] Verify actual protobuf getters and wrapper behavior from the pinned WhatsMeow dependency.
- [x] Detect location, reaction, button reply, and list reply messages.
- [x] Mark media, contacts, poll, and native-flow interactive messages as deferred until their output schemas and media ID strategy are defined.
- [x] Map `ContextInfo` into the domain event.
- [x] Preserve the actual sender for group messages.
- [x] Mark unknown message types as `unsupported`.
- [x] Replace direct `fmt.Printf` error output with consistent logging.

Acceptance criteria:

- The handler only translates WhatsMeow events into domain events.
- The handler does not construct WABA webhook payloads.
- The handler does not contain HTTP forwarding logic.

### Milestone 3: WABA Payload Construction and Logging

Status: Completed

- [x] Refactor `internal/service/message.go` to map domain events explicitly.
- [x] Set `object` to `whatsapp_business_account`.
- [x] Set `changes[].field` to `messages`.
- [x] Set `messaging_product` to `whatsapp`.
- [x] Include configured metadata and business account ID.
- [x] Include contact and base message fields.
- [x] Map each in-scope message body to the matching WABA field.
- [x] Ignore self-sent messages.
- [x] Marshal the final payload as JSON.
- [x] Log the final JSON payload from the service.
- [x] Do not call `WebhookForwarder` in this phase.
- [x] Remove unused webhook client wiring from `cmd/main.go`.

Acceptance criteria:

- Each accepted inbound event produces one logged WABA-shaped JSON payload.
- The logged JSON contains the final mapped payload, not raw WhatsMeow data.
- Optional unsupported fields are omitted.
- No HTTP request is made.

### Milestone 4: Automated Tests

Status: Completed

- [x] Add service tests for text and extended text.
- [x] Add service tests for location.
- [x] Add service tests for reaction and button/list interactive replies.
- [x] Add service tests for context mapping.
- [x] Add service test for unsupported messages.
- [x] Add service test for self-sent messages.
- [x] Add service test for nil input; dependency validation is not applicable because logging is the only service dependency in this phase.
- [x] Add handler tests using representative WhatsMeow protobuf messages for each in-scope type.
- [x] Validate serialized output by decoding the logged JSON and checking the WABA contract fields.

Acceptance criteria:

- Mapping behavior is covered independently from HTTP delivery.
- Self-sent events produce no payload.
- Timestamp, sender, metadata, and entry ID use the documented sources.

### Milestone 5: Verification and Documentation

Status: Completed

- [x] Run `gofmt -w <changed-go-files>`.
- [x] Run `go test ./...`.
- [x] Run `go vet ./...`.
- [x] Update `README.md` if configuration or runtime behavior changes.
- [x] Record verification results in this file.
- [x] Confirm no credentials, databases, binaries, or index artifacts were added.

## Deferred Work

- [ ] Define and implement internal media IDs before enabling media payloads.
- [ ] Define contacts, poll, and native-flow interactive output schemas before enabling those payloads.
- [ ] Persist media descriptors.
- [ ] Implement `GET /media/{media_id}`.
- [ ] Implement temporary download tokens.
- [ ] Implement `GET /download/{token}`.
- [ ] Re-enable HTTP webhook forwarding.
- [ ] Add HMAC signature delivery for forwarded webhooks.

## Verification Log

| Date | Command or activity | Result |
| ---- | ------------------- | ------ |
| 2026-08-02 | Read mapping documentation and inspected current implementation | Completed |
| 2026-08-02 | `go test ./...` before implementation | Passed; no tests found |
| 2026-08-02 | `go vet ./...` before implementation | Passed |
| 2026-08-02 | `go test ./...` after implementation | Passed; 20 tests |
| 2026-08-02 | `go vet ./...` after implementation | Passed |
| 2026-08-02 | Oracle implementation review | Fixed context sender normalization, added JSON-level typed payload coverage, reconciled tracker status |
| 2026-08-02 | Disabled default WhatsMeow stdout logger and added inbound event logging | Passed; `go test ./...` 21 tests and `go vet ./...` passed |

## Decisions

- Payload construction remains in the service layer.
- WhatsMeow-specific translation remains in the WhatsMeow adapter.
- This implementation phase logs payloads only and does not forward them over HTTP.
- Media ID generation and media download are separate follow-up milestones.
