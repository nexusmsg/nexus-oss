# waba-api-unofficial

Unofficial WABA (WhatsApp Business API) webhook event replicator — helps developers test and prototype products that integrate with the official WhatsApp Cloud API without needing a live Business account.

## Overview

`waba-api-unofficial` mimics webhook event delivery from the WhatsApp Business Platform. It lets you replay and forward realistic webhook payloads to your local/development endpoints so you can build, test, and POC your WABA integrations without hitting Meta's APIs.

## Use Cases

- Local development and testing of WABA webhook handlers
- Proof-of-concept (POC) prototypes before WABA approval
- Load testing webhook ingestion pipelines
- Debugging webhook payload formats

## Project Structure

```
cmd/main.go                             # Application composition root
internal/
  adapters/
    whatsmeow/                          # WhatsApp client adapter (whatsmeow)
    webhook/                            # HTTP webhook adapter and HMAC signing
  config/config.go                      # Application configuration
  core/
    domain/                             # Internal event and WABA payload types
    ports/
      message_service.go               # Inbound message service interface
      webhook_forwarder.go             # Webhook forwarding interface
  service/message.go                    # Message mapping, logging, and forwarding
```

## Getting Started

```bash
# Clone the repository
git clone https://github.com/afikrim/waba-api-unofficial.git
cd waba-api-unofficial

# Install dependencies
go mod tidy

# Run
go run cmd/main.go
```

## Current Runtime Behavior

Inbound WhatsMeow messages are translated into WhatsApp Business API-shaped
webhook JSON, logged by the service, and forwarded to the configured webhook
endpoint. Media download endpoints are not enabled yet.

Forwarding is enabled when `WEBHOOK_URL` is set. If it is empty, messages are
still logged but are not sent over HTTP. Requests have a 15-second timeout.
When `WEBHOOK_SECRET` is set, requests include an `X-Hub-Signature-256` HMAC
signature using the exact JSON request body.

The payload metadata is configured through environment variables:

```text
BUSINESS_ACCOUNT_ID
PHONE_NUMBER_ID
DISPLAY_PHONE_NUMBER
WEBHOOK_URL
WEBHOOK_SECRET
```

## License

MIT
