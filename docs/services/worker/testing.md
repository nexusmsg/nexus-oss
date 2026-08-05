# Worker — Testing

Follow `services/worker/AGENTS.md`. Commands run from `services/worker/`:

```bash
gofmt -l .        # must print nothing
go vet ./...
go test ./...     # hermetic unit tests
```

Before handoff, run `go test ./...` and `go vet ./...` and report results.

## Hermetic unit tests

All fakes are in-memory (`fake_*.go`), no real WhatsMeow/Postgres needed:

| Test | Covers |
|------|--------|
| `internal/adapters/whatsmeow/manager_test.go` | EnsureDevice lifecycle, ErrAlreadyPaired, ErrDeviceNotFound, dead-device re-ensure |
| `internal/adapters/whatsmeow/client_test.go` | Connect, Pair, Logout, Disconnect event handling |
| `internal/adapters/whatsmeow/handler_test.go` | Event → InboundEvent anti-corruption (self-sent ignored, unwrapping) |
| `internal/adapters/queue/store_test.go` | Claim/FOR UPDATE SKIP LOCKED, attempt increments, terminal states |
| `internal/adapters/queue/session_store_test.go` | ListSessions, GetByPhoneNumberID, batched UpdateHeartbeats |
| `internal/service/executor_test.go` | send_message/pairing/logout execution, session-not-found, lazy ensure |
| `internal/service/message_test.go` | WABA payload mapping |

## Live integration tests

Gated behind env vars; skipped otherwise (no external service at CI/unit run):

- `internal/adapters/queue/store_integration_test.go`,
  `session_store_integration_test.go` — real Postgres via `TEST_SUPABASE_DSN`.
- Requires migrations applied and the `itest_` cleanup helpers that hard-delete
  rows created by the test prefix.
