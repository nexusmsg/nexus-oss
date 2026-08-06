# Worker — Channel Architecture

## Overview

The worker uses channels for cross-goroutine communication. This document
explains each channel, why it exists, and what was simplified in the
refactoring pass.

The original design had an actor hierarchy (manager → actor → send worker)
with 11 channels and 2N+3 goroutines. After simplification, the manager
goroutine and send workers were removed, leaving 6 channels and N+2
goroutines.

## Channel Inventory (After Simplification)

### Tier 1: Essential

| Channel | Location | Role | Why |
|---|---|---|---|
| `qrChan` | `client.go` | QR pairing events | Imposed by whatsmeow library API (`GetQRChannel`) |
| `consumerErr` | `main.go` | Consumer → main error | Standard goroutine-to-main error reporting |
| `heartbeatErr` | `main.go` | Heartbeat → main error | Standard goroutine-to-main error reporting |
| `lifecycle` | `actor.go` | Actor inbox (buffered 4) | Serializes connect/pair/logout/reconnect per device — these operations must not run concurrently on the same `whatsmeow.Client` |
| `done` | `actor.go` | Actor exit signal | `Shutdown` waits on this to confirm the actor has stopped before disconnecting |

### Tier 2: Justified

| Channel | Location | Role | Why |
|---|---|---|---|
| `resp` (Pair/Logout) | `manager.go` + `actor.go` | Async response from actor to caller | Per-command buffered-1 channel; idiomatic Go for request/response across goroutines |

### Removed (Simplified)

| Was | Replaced By | Why |
|---|---|---|
| `cmds` (manager command channel) | Direct `mu.Lock()` / `mu.RLock()` calls | Manager goroutine serialized nothing — all mutations already used `m.mu` |
| `loopDone` (manager exit signal) | N/A — manager goroutine removed | Only existed because the manager goroutine existed |
| `sendQueue` (buffered 32) | `sendMu sync.Mutex` on `Send()` | Consumer is single-threaded; sends already serialized. Mutex is simpler, no per-send allocation |
| `workerDone` (send worker exit) | N/A — send worker goroutine removed | Only existed because send worker existed |
| `response` (per-send) | Direct return from `Send()` | Allocated a channel per send on the hot path; with mutex, response is just a return value |

## Goroutine Map

### After simplification

```
N + 2 goroutines total:

  N × actor goroutine          ← lifecycle: connect/pair/logout/reconnect per device
  1 × consumer goroutine       ← polls jobs from DB
  1 × heartbeat goroutine      ← updates last_seen_at per interval
```

### Before (what was removed)

```
2N + 3 goroutines total:

  1 × manager goroutine        ← REMOVED: was a message router that serialized nothing
  N × actor goroutine          ← KEPT: owns connection lifecycle
  N × send worker goroutine    ← REMOVED: consumer is single-threaded, mutex is enough
  1 × consumer goroutine       ← KEPT: polls jobs from DB
  1 × heartbeat goroutine      ← KEPT: updates last_seen_at per interval
```

**Removed**: manager goroutine + N send worker goroutines = N+1 fewer goroutines.

## Flow Diagrams

### Pair command (simplified)

```
caller → m.lookup (RLock) → ref.lifecycle → actor → cmd.resp → caller

4 hops across 2 goroutines. No manager routing.
```

### Send message (simplified)

```
executor.Send() → sendMu.Lock() → validate → send → sendMu.Unlock()
     ↓
   return (result, error)

1 goroutine, 0 channel hops. Direct call + mutex.
```

### EnsureDevice (simplified)

```
caller → m.mu.Lock() → resolveDevice → newDeviceRef → go ref.run() → return

Direct method call. No channels.
```

### Logout (simplified)

```
caller → m.lookup (RLock) → ref.lifecycle → actor → ref.onRemoved() → ref.cancel() → cmd.resp → caller

Actor calls onRemoved callback, then self-cancels to prevent goroutine leak.
```

## Design Decisions

### Why keep the per-device actor?

The actor goroutine is the single owner of the connection lifecycle:
- **Connect/reconnect** with bounded backoff timer
- **Pair** with cancelable pair context (QR flow)
- **Logout** with cleanup

These operations must be serialized — calling `ConnectContext`, `Disconnect`, and `Logout` concurrently on the same `whatsmeow.Client` causes race conditions. The `lifecycle` channel is the inbox that serializes them.

### Why remove the manager goroutine?

The manager goroutine received commands on `cmds` and routed them to actors or handled them under `m.mu.Lock()`. But every handler already acquired the mutex — the goroutine serialized nothing. It was a message router that added a context-switch hop to every operation for zero benefit.

The replacement: callers do `m.mu.Lock()` or `m.mu.RLock()` directly and call the work inline. Map access patterns (`lookup`, `removeDevice`) stay as methods.

### Why replace send worker with mutex?

The send worker (`sendLoop`) serialized outbound sends per device. But the job consumer is single-threaded — it processes jobs one at a time. Sends were already serialized by the consumer loop. The send worker provided:

- **Defense-in-depth** for future concurrent senders → reasonable but YAGNI
- **Clean shutdown** via `failQueuedSends` → queue layer handles retries anyway
- **Backpressure** via buffered channel → `Send` blocks on response either way

A `sync.Mutex` on `Send()` achieves the same serialization with fewer lines, no per-send allocation, and simpler shutdown.

## Bug Fixes Applied

### Goroutine leak on logout (fixed)

**Before**: After logout, the actor sent `mgrRemoveDevice` to the manager and returned to its select loop — but since the ref was removed from maps, no new commands would arrive. The goroutine leaked until manager shutdown.

**After**: The actor calls `ref.onRemoved()` (callback to manager's `removeDevice`), then `ref.cancel()` to exit immediately. No leak.

### `cmdStop` dead code (removed)

`cmdStop` was defined and handled but never sent by any caller. It was likely intended to fix the goroutine leak but was never wired up. Removed along with the manager goroutine.

## Summary

| Metric | Before | After |
|---|---|---|
| Channels | 11 | 6 |
| Goroutines | 2N+3 | N+2 |
| Lines of plumbing | ~350 | ~200 |
| Goroutine leaks | 1 (on logout) | 0 |
