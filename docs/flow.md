## 1. Session Creation

```mermaid
flowchart LR

A[User] --> B[Create Session]
B --> C{Number Used?}

C -- Yes --> B
C -- No --> D[Insert into Sessions Table]
```

---

## 2. Pairing Session

```mermaid
flowchart TB

subgraph API
    A[User]
    B[Select Session]
    C[Request Pairing]
    D[Create New Pairing Job]
    E[Check if QR Code Payload Received]
    F{Received?}
    G[Show QR to User]
    H[User Scan QR]
    I[Session Stored in Database]

    A --> B --> C --> D --> E --> F
    F -- No --> E
    F -- Yes --> G --> H --> I
end

subgraph Worker
    W1[Claim Pending Job]
    W2[Request Connect WhatsApp]
    W3[Send Callback with QR Content]

    W1 --> W2 --> W3
end

D -. enqueue .-> W1
W3 -. callback .-> E
```

---

## 3. Logout Session

```mermaid
flowchart TB

subgraph API
    A[User]
    B[Select Session]
    C[Request Logout]
    D[Create Logout Job]
    E[Check if Logout Completed]
    F{Completed?}
    G[Mark Session Logged Out]

    A --> B --> C --> D --> E --> F
    F -- No --> E
    F -- Yes --> G
end

subgraph Worker
    W1[Claim Pending Job]
    W2[Request Logout WhatsApp]
    W3[Cleanup Session]
    W4[Send Callback to API]

    W1 --> W2 --> W3 --> W4
end

D -. enqueue .-> W1
W4 -. callback .-> E
```

---

## 4. Heartbeat

```mermaid
flowchart LR

A[Worker]
--> B[Every 10 Seconds]
--> C[Send Heartbeat to API]
```

---

## 5. Send Message

```mermaid
flowchart TB

subgraph API
    A[User]
    B[Request Send Message]
    C[Create Send Message Job]
    D[Check if Message Has Been Sent]
    E{Sent?}
    F[Send FCM Notification]

    A --> B --> C --> D --> E
    E -- No --> D
    E -- Yes --> F
end

subgraph Worker
    W1[Claim Pending Job]
    W2[Send Message]
    W3[Callback to API]

    W1 --> W2 --> W3
end

C -. enqueue .-> W1
W3 -. callback .-> D
```

---

## 6. Incoming WhatsApp Message

```mermaid
flowchart LR

A[WhatsApp]
--> B[Worker Receive New Message]
--> C[Call API to Retrieve Webhook Config]

C --> D[Send Webhook]

C --> E[Send Callback to API]

E --> F[API Receive Callback of Inbound Message]
--> G[Send FCM Token]
```

---

## 7. Generic Job Retry

```mermaid
flowchart LR

A[Worker Claim Pending Job]
--> B[Start Retry Config]
--> C[Execute]
--> D{Success?}

D -- Yes --> E[Update Job Status]

D -- No --> F{Retryable?}

F -- Yes --> B
F -- No --> E
```
