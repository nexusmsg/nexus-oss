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
    httpapi/                             # Echo v4 Direct Send-compatible API
    webhook/                            # HTTP webhook adapter and HMAC signing
  config/config.go                      # Application configuration
  core/
    domain/                             # Internal event and WABA payload types
    ports/
      message_service.go               # Inbound message service interface
      message_sender.go                 # Outbound message sender interfaces
      webhook_forwarder.go             # Webhook forwarding interface
  service/message.go                    # Inbound mapping, logging, and forwarding
  service/outbound.go                   # Outbound validation and response mapping
```

## Getting Started

```bash
# Clone the repository
git clone https://github.com/afikrim/waba-api-unofficial.git
cd waba-api-unofficial

# Install dependencies
go mod tidy

# Run the application
go run ./cmd
```

## Configuration

Set the WhatsMeow and WABA-compatible values before starting the application:

```bash
WEBHOOK_URL="" \
BUSINESS_ACCOUNT_ID="your-business-id" \
PHONE_NUMBER_ID="your-phone-id" \
DISPLAY_PHONE_NUMBER="+628123456789" \
API_AUTH_TOKEN="optional-token" \
PORT="8080" \
go run ./cmd
```

`PHONE_NUMBER_ID` identifies the sending account and must also be used in the
Direct Send URL. `API_AUTH_TOKEN` is optional; when set, every Direct Send
request must use the matching bearer token. Leave `WEBHOOK_URL` empty when
testing outbound messages only. If webhook forwarding is enabled, point it to
a separate receiver rather than the application's Direct Send port.

## Current Runtime Behavior

Inbound WhatsMeow messages are translated into WhatsApp Business API-shaped
webhook JSON, logged by the service, and forwarded to the configured webhook
endpoint. The application also exposes a local Direct Send-compatible endpoint
and sends text messages through the already-connected WhatsMeow client. Media
download endpoints are not enabled yet.

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
API_AUTH_TOKEN
PORT
```

## Direct Send API

The local API mirrors the Direct Send route shape:

```text
POST /<PHONE_NUMBER_ID>/messages
```

When `API_AUTH_TOKEN` is set, requests must include:

```text
Authorization: Bearer <API_AUTH_TOKEN>
```

The initial outbound implementation supports text messages:

```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "628123456789",
  "type": "text",
  "text": {
    "body": "Hello"
  },
  "category": "utility"
}
```

Send a test message to a WhatsApp number using digits only, without the leading
`+`:

```bash
curl -X POST "http://localhost:8080/your-phone-id/messages" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer optional-token" \
  -d '{
    "messaging_product": "whatsapp",
    "recipient_type": "individual",
    "to": "6285293322073",
    "type": "text",
    "text": {
      "body": "Test message dari Direct Send API"
    },
    "category": "utility"
  }'
```

Omit the `Authorization` header when `API_AUTH_TOKEN` is empty. Replace
`your-phone-id` with the exact value configured in `PHONE_NUMBER_ID`.

Outbound requests are dispatched through a bounded channel to the single
WhatsMeow connection. Template, CTA URL, reply, mixed-button, TTL, media, and
full authentication message support remain deferred.

## License

[MIT](LICENSE)
