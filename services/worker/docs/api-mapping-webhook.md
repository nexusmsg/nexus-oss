# WhatsMeow → WhatsApp Business API (WABA) Webhook Mapping

## Overview

This document defines the mapping between `whatsmeow/types/events.Message` and the WhatsApp Business Platform Official Webhook payload.

The goal is to make a WhatsMeow-based gateway behave as a drop-in replacement for the WABA Official API, allowing existing WABA integrations to work without modification.

---

# Event Mapping

## Root Object

| WABA                    | WhatsMeow                              | Notes                    |
| ----------------------- | -------------------------------------- | ------------------------ |
| object                  | Constant `"whatsapp_business_account"` | Static                   |
| entry[].id              | Gateway Configuration                  | WABA Business Account ID |
| entry[].changes[].field | Constant `"messages"`                  | Static                   |

---

## Metadata

| WABA                          | WhatsMeow             | Notes                |
| ----------------------------- | --------------------- | -------------------- |
| messaging_product             | Constant `"whatsapp"` | Static               |
| metadata.display_phone_number | Gateway Configuration | Device configuration |
| metadata.phone_number_id      | Gateway Configuration | Internal phone ID    |

---

## Contact

| WABA                    | WhatsMeow              |
| ----------------------- | ---------------------- |
| contacts[].wa_id        | `evt.Info.Sender.User` |
| contacts[].profile.name | `evt.Info.PushName`    |

---

## Base Message

| WABA                 | WhatsMeow                   |
| -------------------- | --------------------------- |
| messages[].id        | `evt.Info.ID`               |
| messages[].from      | `evt.Info.Sender.User`      |
| messages[].timestamp | `evt.Info.Timestamp.Unix()` |

---

# Message Type Mapping

| WABA Type   | WhatsMeow Message                     |
| ----------- | ------------------------------------- |
| text        | Conversation / ExtendedTextMessage    |
| image       | ImageMessage                          |
| video       | VideoMessage                          |
| audio       | AudioMessage                          |
| document    | DocumentMessage                       |
| sticker     | StickerMessage                        |
| location    | LocationMessage                       |
| contacts    | ContactMessage / ContactsArrayMessage |
| reaction    | ReactionMessage                       |
| interactive | ButtonsResponseMessage                |
| interactive | ListResponseMessage                   |
| interactive | InteractiveResponseMessage            |
| poll        | PollCreationMessage                   |
| unsupported | Unknown message                       |

---

# Text Message

## Conversation

| WABA      | WhatsMeow      |
| --------- | -------------- |
| text.body | `Conversation` |

---

## Extended Text

| WABA      | WhatsMeow                  |
| --------- | -------------------------- |
| text.body | `ExtendedTextMessage.Text` |

---

# Image Message

| WABA            | WhatsMeow                 |
| --------------- | ------------------------- |
| image.id        | Internal Media ID         |
| image.mime_type | `ImageMessage.Mimetype`   |
| image.sha256    | `ImageMessage.FileSHA256` |
| image.caption   | `ImageMessage.Caption`    |

---

# Video Message

| WABA            | WhatsMeow                 |
| --------------- | ------------------------- |
| video.id        | Internal Media ID         |
| video.mime_type | `VideoMessage.Mimetype`   |
| video.sha256    | `VideoMessage.FileSHA256` |
| video.caption   | `VideoMessage.Caption`    |

---

# Audio Message

| WABA            | WhatsMeow                 |
| --------------- | ------------------------- |
| audio.id        | Internal Media ID         |
| audio.mime_type | `AudioMessage.Mimetype`   |
| audio.sha256    | `AudioMessage.FileSHA256` |
| audio.voice     | `AudioMessage.PTT`        |

---

# Document Message

| WABA               | WhatsMeow                    |
| ------------------ | ---------------------------- |
| document.id        | Internal Media ID            |
| document.mime_type | `DocumentMessage.Mimetype`   |
| document.sha256    | `DocumentMessage.FileSHA256` |
| document.filename  | `DocumentMessage.FileName`   |
| document.caption   | `DocumentMessage.Caption`    |

---

# Sticker Message

| WABA              | WhatsMeow                        |
| ----------------- | -------------------------------- |
| sticker.id        | Internal Media ID                |
| sticker.mime_type | `StickerMessage.Mimetype`        |
| sticker.sha256    | `StickerMessage.FileSHA256`      |
| sticker.animated  | `events.Message.IsLottieSticker` |

---

# Location Message

| WABA               | WhatsMeow                          |
| ------------------ | ---------------------------------- |
| location.latitude  | `LocationMessage.DegreesLatitude`  |
| location.longitude | `LocationMessage.DegreesLongitude` |
| location.name      | `LocationMessage.Name`             |
| location.address   | `LocationMessage.Address`          |

---

# Contact Message

| WABA | WhatsMeow | Notes |
|---|---|---|
| contacts[].name.formatted_name | vCard `FN` property | Fallback to `ContactMessage.DisplayName` if `FN` is empty |
| contacts[].name.first_name | vCard `N` given-name component | |
| contacts[].name.last_name | vCard `N` family-name component | |
| contacts[].name.middle_name | vCard `N` additional-name component | |
| contacts[].name.prefix | vCard `N` prefix component | |
| contacts[].name.suffix | vCard `N` suffix component | |
| contacts[].phones[].phone | vCard `TEL` value | |
| contacts[].phones[].type | vCard `TEL` TYPE param | CELL/MOBILE → `"HOME"`, WORK → `"WORK"`, default → `"HOME"` |
| contacts[].phones[].wa_id | Populated via `IsOnWhatsApp` lookup | Internal only; not exposed as API endpoint |
| contacts[].emails[].email | vCard `EMAIL` value | |
| contacts[].emails[].type | vCard `EMAIL` TYPE param | |
| contacts[].addresses[].street | vCard `ADR` street component | |
| contacts[].addresses[].city | vCard `ADR` locality component | |
| contacts[].addresses[].state | vCard `ADR` region component | |
| contacts[].addresses[].zip | vCard `ADR` postal-code component | |
| contacts[].addresses[].country | vCard `ADR` country-name component | |
| contacts[].addresses[].country_code | Not available in vCard | Omitted |
| contacts[].org.company | vCard `ORG` first component | |
| contacts[].org.department | vCard `ORG` second component | |
| contacts[].org.title | vCard `TITLE` | |
| contacts[].urls[].url | vCard `URL` value | |
| contacts[].urls[].type | vCard `URL` TYPE param | |
| contacts[].birthday | vCard `BDAY` | Normalized to `YYYY-MM-DD` |

For `ContactsArrayMessage` (multi-contact), each contact is parsed independently. The outer `displayName` has no WABA equivalent and is dropped.

Outbound: WABA `contacts[]` array → vCard strings → `ContactMessage` (single) or `ContactsArrayMessage` (multiple).

---

# Reaction Message

| WABA                | WhatsMeow                |
| ------------------- | ------------------------ |
| reaction.message_id | `ReactionMessage.Key.ID` |
| reaction.emoji      | `ReactionMessage.Text`   |

---

# Interactive Message

## Button Reply

| WABA                           | WhatsMeow                                    |
| ------------------------------ | -------------------------------------------- |
| interactive.type               | `"button_reply"`                             |
| interactive.button_reply.id    | `ButtonsResponseMessage.SelectedButtonID`    |
| interactive.button_reply.title | `ButtonsResponseMessage.SelectedDisplayText` |

---

## List Reply

| WABA                               | WhatsMeow                                             |
| ---------------------------------- | ----------------------------------------------------- |
| interactive.type                   | `"list_reply"`                                        |
| interactive.list_reply.id          | `ListResponseMessage.SingleSelectReply.SelectedRowID` |
| interactive.list_reply.title       | `ListResponseMessage.Title`                           |
| interactive.list_reply.description | `ListResponseMessage.Description`                     |

---

# Context Mapping

Whenever a WhatsMeow message contains `ContextInfo`, it should be mapped into the WABA Context object.

| WABA         | WhatsMeow                 |
| ------------ | ------------------------- |
| context.id   | `ContextInfo.StanzaID`    |
| context.from | `ContextInfo.Participant` |

---

# Unsupported Fields

The following WABA fields cannot be reconstructed from WhatsMeow.

| WABA Field                       | Reason                                  |
| -------------------------------- | --------------------------------------- |
| referral                         | Only generated by Click-to-WhatsApp Ads |
| context.referred_product         | Only available for WhatsApp Catalog     |
| system.customer_identity_changed | Not exposed by WhatsMeow                |
| metadata.phone_number_id         | Gateway configuration                   |
| metadata.display_phone_number    | Gateway configuration                   |

---

# Internal Media ID

Unlike WABA Cloud API, WhatsMeow does not expose a Media ID.

Instead, the gateway generates an Internal Media ID for every incoming media message.

Example

```json
{
  "document": {
    "id": "med_01K6T6QJ1Y9M8G8A7..."
  }
}
```

The mapping is stored internally.

| Internal Field    | Source               |
| ----------------- | -------------------- |
| Internal Media ID | Generated by Gateway |
| DirectPath        | WhatsMeow            |
| MediaKey          | WhatsMeow            |
| FileSHA256        | WhatsMeow            |
| FileEncSHA256     | WhatsMeow            |
| FileLength        | WhatsMeow            |
| MimeType          | WhatsMeow            |
| FileName          | WhatsMeow            |

---

# Media Download Flow

To emulate the WABA Official API, media downloads should follow a two-step process.

```text
Incoming Media
        │
        ▼
WhatsMeow Event
        │
        ▼
Generate Internal Media ID
        │
        ▼
Persist Media Descriptor
        │
        ▼
Webhook Sent
        │
        ▼
Client receives

document.id = med_xxxxx
```

Later

```text
GET /media/{media_id}
```

```text
Lookup Internal Media ID
        │
        ▼
Load Media Descriptor
        │
        ▼
Call whatsmeow.Client.Download()
        │
        ▼
Receive Binary
        │
        ▼
Store Temporary Download Token
        │
        ▼
Return

{
    "url": "https://gateway.example.com/download/xxxxx",
    "mime_type": "...",
    "sha256": "...",
    "file_size": 123456
}
```

Finally

```text
GET /download/{token}
```

```text
Validate Token
        │
        ▼
Stream Binary
```

This flow closely mirrors the behavior of the WhatsApp Business Platform Cloud API while hiding all WhatsMeow-specific implementation details such as `DirectPath`, `MediaKey`, and encrypted media handling.

---

# Replication Limits

The gateway replicates what WhatsMeow can provide via the WhatsApp device protocol. Not every WABA Cloud API feature has an equivalent in the unofficial protocol. The table below documents known gaps and the reasoning behind each decision.

## Cannot Replicate (No Hybrid Approach)

The gateway does **not** fall back to the official Cloud API for writes. Everything must be achievable through the WhatsApp device protocol alone.

| WABA Feature | Why Not Possible | Gateway Behavior |
|---|---|---|
| **Business Profile CRUD** (write `about`, `description`, `email`, `address`, `websites`, `vertical`, `profile_picture`) | WhatsMeow only has `GetBusinessProfile` (read-only IQ `w:biz`). No public `set` variant exists in whatsmeow or Baileys. The GraphQL mutation (`WAWebEditBizProfileMutation`) requires Meta auth (FB/IG session), not the device session, and is undocumented with ban risk. Fields like `vertical`, `business_hours`, and `categories` have no unofficial write path at all. | Read-only via `GetBusinessProfile`. Writes must be done through Meta Business Suite or the official Cloud API. |
| **REQUEST_CONTACT_INFO button** (send) | Button layer is WABA-only. WhatsMeow has no API to send interactive buttons with `request_contact_info` action. | Cannot send. Can **receive** the result as a normal `contacts` message with `origin: "contact_request"`. |
| **Contact Book API** (BSUID management) | Meta-hosted identity table. Not accessible via the device protocol. Only available through the Cloud API (`GET/POST/DELETE /{phone-number-id}/contact_book`). | Not replicated. BSUID support will be handled when the outbound message API accepts `recipient` fields (phone or BSUID). |
| **smb_app_state_sync webhook** (business customer address book) | Tied to the SMB embedded-signup flow and solution-partner onboarding. The WhatsMeow contact app-state patch (`WAPatchCriticalUnblockLow`) is the **user's own** phone address book, not the business customer's WA Business app address book. | Not emitted. The semantic is different — translating it would produce misleading `smb_app_state_sync` events. |
| **Phone → JID lookup** (`IsOnWhatsApp`) | WABA has no public equivalent endpoint. This is a WhatsApp device protocol feature only. | Available internally for contact card `wa_id` resolution, but not exposed as a gateway API endpoint. |
| **Block list** (`GetBlocklist` / `UpdateBlocklist`) | WABA does not expose block management via its API. Managed in the WA Business app. | Available internally but not exposed as a gateway API endpoint. |
| **Contact QR / Business Message Links** (`GetContactQRLink`, `ResolveBusinessMessageLink`) | WABA has no concept of `wa.me/qr/...` or `wa.me/message/...` links. | Available internally but not exposed as a gateway API endpoint. |

## Partially Replicable

| WABA Feature | WhatsMeow Equivalent | Gap | Gateway Behavior |
|---|---|---|---|
| **Contact Message (vCard)** | `ContactMessage` / `ContactsArrayMessage` (raw vCard string) | WABA pre-parses vCard into structured `ContactObject` (name, phones, emails, addresses, org, urls, birthday); WhatsMeow hands you a raw vCard blob. | vCard will be parsed into WABA `ContactObject` shape on receive. The `phones[].wa_id` field requires an `IsOnWhatsApp` lookup to populate (internal only). |
| **Push Name / Business Name** | `events.PushName` / `events.BusinessName` from inbound message metadata | WABA surfaces `profile.name` on every webhook message; WM only emits events on first sighting or name change. | Mapped via `evt.Info.PushName` on the base contact object. Consistent with existing `api-mapping-webhook.md` contact table. |
| **Identity Key Hash** | `events.IdentityChange` (carries JID + timestamp) | WABA provides `identity_key_hash` in contact webhook when identity-change check is enabled; WM does not expose a hash. | Field omitted from webhook payload. |

## Design Principle

When a WABA feature has no WhatsMeow equivalent:

1. **Omit** the field rather than inventing a value.
2. **Document** the gap in this file.
3. **Do not** implement a hybrid approach (calling the official Cloud API for writes). The gateway is a drop-in replacement via the device protocol only.
4. If a feature becomes critical for a customer, evaluate whether to add a **separate** admin API or document that it must be done through Meta Business Suite.
