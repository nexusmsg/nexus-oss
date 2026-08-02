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

| WABA     | WhatsMeow                             |
| -------- | ------------------------------------- |
| contacts | ContactMessage / ContactsArrayMessage |

The VCard should be parsed into the WABA Contact Object.

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
