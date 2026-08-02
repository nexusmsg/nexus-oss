# WABA Direct Send Implementation Plan

## Objective

Expose a local Echo v4 HTTP API compatible with the WABA Direct Send request and response shape, and route outbound messages through the one already-connected WhatsMeow client.

## Scope

- `POST /:phone_number_id/messages`
- WABA-shaped JSON request and response models
- Text messages first, with Direct Send category validation
- Optional bearer-token authentication
- Channel-backed outbound dispatch with one long-lived worker
- Graceful shutdown and focused tests

## Milestones

### 1. Domain and Port

Status: Completed

- Add outbound request and result domain models.
- Add `ports.MessageSender` without exposing Echo or WhatsMeow types.
- Add an outbound application service boundary; Echo must not own WABA validation or WhatsMeow mapping.
- Preserve optional WABA fields with JSON tags and omit unsupported output fields.

### 2. WhatsMeow Dispatch

Status: Completed

- Add an internal command channel to the existing WhatsMeow adapter.
- Add one worker that calls the existing `whatsmeow.Client.SendMessage`.
- Use a bounded queue as deliberate first-cut backpressure; parallel workers are deferred.
- Propagate request contexts, worker errors, and shutdown cancellation.
- Reject new work after the dispatcher enters its closed state.
- On shutdown: stop HTTP intake, close dispatcher intake, let in-flight work finish or cancel, resolve queued work, then disconnect WhatsMeow.
- A queued request must be checked for cancellation before enqueue, while enqueueing, after dequeue, and before calling `SendMessage`.
- Never create or connect a WhatsMeow client per HTTP request.

### 3. Mapping and Validation

Status: Completed for text messages

- Parse `to` into a WhatsMeow JID.
- Map WABA text content to `waE2E.Message.Conversation`.
- Validate `messaging_product`, `type`, text body, and category.
- Support `utility`, `authentication`, `service`, and omitted category values according to the Direct Send documentation.

### 4. Echo API

Status: Completed

- Add an HTTP API adapter using Echo v4.
- Target `github.com/labstack/echo/v4`, not Echo v5 APIs.
- Decode the JSON body separately; do not use Echo's combined path/query/body `c.Bind` behavior for this endpoint.
- Return WABA-shaped success and error responses through explicit response models.
- Validate the route phone number ID against configured `PHONE_NUMBER_ID`.
- Add recovery, request logging, a string-form Echo v4 body limit, and graceful server shutdown.
- Use the configured `PORT`.

### 5. Authentication and Lifecycle

Status: Completed for optional static bearer token

- Add optional bearer-token configuration.
- Use custom authentication failure responses instead of Echo-native error JSON.
- Wire HTTP server, WhatsMeow connection, dispatcher, and shutdown through `cmd/main.go`.
- Stop accepting work before closing the dispatcher and WhatsMeow client.

### 6. Verification and Documentation

Status: Completed

- Add handler, service, dispatcher, and lifecycle tests.
- Cover cancellation before enqueue, while queued, and during an in-flight send.
- Cover dispatcher close/rejection and shutdown with queued and in-flight work.
- Cover exact WABA error envelopes for binding, authentication, validation, and send failures.
- Update `README.md` with endpoint, configuration, examples, and supported types.
- Update `HANDOFF.md` with actual runtime behavior, limitations, changed files, and verification results.
- Run `gofmt`, `go test ./...`, and `go vet ./...`.

## Initial Boundary

The first implementation should support text messages and the WABA Direct Send request envelope. Template, CTA URL, reply, mixed-button, TTL, and other message types remain deferred until their WhatsMeow mappings and exact contracts are verified.

## Acceptance Criteria

- A valid WABA-shaped POST sends through the existing connected WhatsMeow client.
- No connection is created per request.
- HTTP cancellation reaches the dispatch operation.
- Success and errors use stable WABA-shaped JSON.
- Existing inbound webhook behavior remains unchanged.
- Tests and static analysis pass.

## Verification Log

| Date | Command | Result |
| ---- | ------- | ------ |
| 2026-08-02 | `go test ./...` | Passed; 30 tests |
| 2026-08-02 | `go test -race ./...` | Passed; 32 tests |
| 2026-08-02 | `go vet ./...` | Passed |
| 2026-08-02 | final `go test ./...`, `go test -race ./...`, `go vet ./...`, `git diff --check` | Passed; 32 tests |
