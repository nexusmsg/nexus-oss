# Worker — Testing

Follow `services/worker/AGENTS.md`. Commands run from `services/worker/`:

```bash
gofmt -l .        # must print nothing
go vet ./...
go test ./...     # hermetic unit + functional tests (no containers needed)
```

Before handoff, run `go test ./...` and `go vet ./...` and report results.

`go test ./...` is fully hermetic: it runs the pure-function unit tests and the
`internal/service` functional tests (mocked ports, no real WhatsMeow/Postgres).
The tagged integration suites in `test/integration/` are excluded and need
containers; see below.

## Test pyramid (M16)

### Unit tests — pure functions only

Unit tests target pure functions and never import adapters or touch external
systems. All fakes are in-memory (`fake_*.go`):

| Test | Covers |
|------|--------|
| `internal/core/entity/outcome_test.go` | outcome classification, terminal-attempt math, backoff |
| `internal/core/entity/outbound_test.go` | outbound message / job-result JSON round-trips, validation error |
| `internal/core/entity/vcard_test.go` | vCard parse + build round-trip, invalid input |
| `internal/adapters/apiconfig/dto/mapper_test.go` | apiconfig DTO mapping |
| `internal/adapters/queue/dto/mapper_test.go` | queue DTO mapping |
| `internal/adapters/webhook/dto/mapper_test.go` | webhook DTO mapping |
| `internal/adapters/whatsmeow/dto/outbound_test.go` | whatsmeow outbound DTO mapping (waE2E messages) |
| `internal/handlers/whatsapp/dto/mapper_test.go` | whatsapp handler DTO mapping |
| `internal/service/validate_test.go` | `validateOutboundMessage` accept/reject per category |

### Functional tests — `internal/service` with mocked ports

Service use cases are tested with in-memory fakes (`fakes_test.go`), mocked
ports, and a hermetic sleeper injection (backoff sequences asserted without a
real clock). No adapters are imported:

| Test | Covers |
|------|--------|
| `internal/service/message_test.go` | WABA payload mapping + forwarding, self-sent ignored, retry budget, context cancel, provider errors |
| `internal/service/whatsapp_executor_test.go` | send/pairing/logout execution, session-not-found, lazy ensure, jobs write-back |
| `internal/service/dispatcher_test.go` | send-payload validation, dispatch, `ErrDispatched` flow |
| `internal/service/split_flow_test.go` | functional split flow: dispatch → whatsmeow_jobs → executor → jobs write-back |

## Integration tests — `test/integration/`

The integration suite lives in `test/integration/` behind the `integration`
build tag, so `go test ./...` skips it entirely:

```bash
# WireMock suites (webhook forward + apiconfig) — need the WireMock container on :8080
go test -tags integration ./test/integration/... -run 'Webhook|Apiconfig'

# Real-Postgres suites — need TEST_DATABASE_URL; migrations resolved from shared/db/migrations
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/waba_test?sslmode=disable \
  go test -tags integration ./test/integration/... -run RealDB
```

- **WireMock suites** (`-run 'Webhook|Apiconfig'`) never skip; the WireMock
  server must be up on `:8080` (base URL overridable via `WIREMOCK_URL`).
  Static mappings live under `testdata/wiremock/`; golden files under
  `testdata/golden/` (e.g. `webhook_forward_body.json`). Run
  `go test -update` to regenerate the goldens and review the diff manually.
- **RealDB suites** (`-run RealDB`) skip when `TEST_DATABASE_URL` is unset.
  They connect to a real Postgres (e.g.
  `postgres://postgres:postgres@localhost:5433/waba_test?sslmode=disable`),
  apply migrations resolved from `shared/db/migrations`, and clean up rows
  created under the test prefix.
