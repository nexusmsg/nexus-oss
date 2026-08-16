# Runtime Flows

Mermaid diagrams for the current runtime flows. Architecture reference:
[docs/architecture/README.md](architecture/README.md).

## 1. Session Creation

```mermaid
flowchart LR

A[POST /api/v1/sessions] --> B{phone_number_id exists?}
B -- Yes --> C[Return existing session]
B -- No --> D[Insert into sessions table]
D --> E[Return session with serial]
```

Session create is idempotent per `phone_number_id`.

## 2. Pairing Session

```mermaid
flowchart TB

subgraph Dashboard API
    A[User] --> B[Select Session]
    B --> C[POST pairing - enqueue pairing job]
    C --> E[GET pairing/qr - poll for QR]
    E --> F{QR received?}
    F -- No --> E
    F -- Yes --> G[Show QR to User]
    G --> H[User scans QR]
end

subgraph Worker
    W1[whatsapp_worker claims pairing job]
    W2[DeviceManager connects device]
    W3[QR stored in session_qr_codes]
    W4[Session stored in sessions table]

    W1 --> W2 --> W3 --> W4
end

C -. enqueue .-> W1
W3 -. qr_job_serial .-> E
```

The QR payload is persisted in `session_qr_codes`; the dashboard polls
`GET /api/v1/sessions/<serial>/pairing/qr` until it appears, then shows it.

## 3. Logout Session

```mermaid
flowchart TB

subgraph Dashboard API
    A[User] --> B[Select Session]
    B --> C[POST logout - enqueue logout job]
    C --> E[Poll session status]
    E --> F{Logged out?}
    F -- No --> E
    F -- Yes --> G[Mark session logged out]
end

subgraph Worker
    W1[whatsapp_worker claims logout job]
    W2[Disconnect WhatsApp]
    W3[Remove stored session]

    W1 --> W2 --> W3
end

C -. enqueue .-> W1
W3 -. status .-> E
```

## 4. Heartbeat

```mermaid
flowchart LR

A[whatsapp_worker]
--> B[Every HEARTBEAT_INTERVAL]
--> C[POST /internal/v1/heartbeat]
--> D[Dashboard batch-updates sessions.last_seen_at]
```

## 5. Send Message

```mermaid
flowchart TB

subgraph Dashboard API
    A[Request send message]
    B[Insert jobs row]
    C[Poll jobs for terminal status]

    A --> B --> C
end

subgraph cmd/worker dispatcher
    D1[Claims jobs row - SKIP LOCKED]
    D2[Validates payload]
    D3[Inserts whatsmeow_jobs row - source_job_serial]
    D4[Returns ErrDispatched - jobs stays claimed]

    D1 --> D2 --> D3 --> D4
end

subgraph cmd/whatsapp_worker executor
    E1[Claims whatsmeow_jobs row]
    E2[ensureDevice - lazy connect]
    E3[SendMessage - real wamid]
    E4[Writes terminal status + result to jobs]

    E1 --> E2 --> E3 --> E4
end

B -. insert .-> D1
D3 -. whatsmeow_jobs .-> E1
E4 -. result.wa_message_id .-> C
C --> F[Return WABA 200 envelope with wamid]
```

> The engine path above is wired end-to-end (queue → dispatcher → executor →
> write-back), but the **public send route is not exposed yet** — it was in the
> archived Hono API and is pending in the dashboard (ROADMAP Phase 3).

## 6. Incoming (WhatsApp -> Customer Webhook)

```mermaid
flowchart TB

A[WhatsApp event]
--> B[whatsapp_worker handler]
--> C[Build WABA-shaped payload - service layer]
--> D[GET /internal/v1/webhook-config - dashboard]
--> E[Forward to customer webhook - HMAC signature]
--> F{Customer ack?}
F -- No --> G[Retry with backoff, then drop]
F -- Yes --> H[Done]
```

## 7. Generic Job Retry

```mermaid
flowchart LR

A[Claim job - SKIP LOCKED]
--> B[Execute]
--> C{Outcome?}
C -- Success --> D[Complete with result]
C -- Retryable --> E[Backoff + increment attempts]
E --> F{attempts < MAX_ATTEMPTS?}
F -- Yes --> A
F -- No --> G[Fail permanently]
C -- Terminal error --> G
```
