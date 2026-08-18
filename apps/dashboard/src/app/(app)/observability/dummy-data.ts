/* ── Dummy activity data ────────────────────────────────────
 * Shared source of truth for the observability pages while the UI is
 * not yet wired to the live `listActivities`/`getActivity` endpoints.
 * Each row matches the `ActivityEvent` contract (src/lib/api/types.ts)
 * so swapping to the real API later is a drop-in replacement.
 * ─────────────────────────────────────────────────────────── */

import type { ActivityEvent } from "@/lib/api/types";

export const DUMMY_ACTIVITIES: ActivityEvent[] = [
  {
    serial: "0f3b6f2a-9c1e-4c5d-8a4f-6e7d9c0b1a2b",
    type: "api_request",
    status: "ok",
    phoneNumberId: "108529403728149",
    businessAccountId: "wa_biz_9d3f21",
    summary: "POST /api/v1/1/108529403728149/messages",
    jobSerial: "6e4a8c21-d0b2-4f7a-9a3d-1c2e5f6a7b8c",
    waMessageId: "wamid.AgQ3NTUwNjc0ODI4NTk=",
    sourceActivitySerial: null,
    resourceType: "session",
    resourceSerial: "59d1a8e4-2b3c-4f6a-8e2d-7a9b0c1d2e3f",
    requestSerial: "api_key_9a2b",
    payload: { method: "POST", path: "/messages", body: { to: "6281234567890" } },
    createdAt: "2026-08-18T09:41:22.000Z",
  },
  {
    serial: "1c7d2b3e-5f6a-4b8c-9d2e-3a4b5c6d7e8f",
    type: "whatsapp_event",
    status: "ok",
    phoneNumberId: "108529403728149",
    businessAccountId: "wa_biz_9d3f21",
    summary: "Inbound message from 6281234567890",
    jobSerial: null,
    waMessageId: "wamid.AgQ4NjEwNzU4OTMxMDE=",
    sourceActivitySerial: "0f3b6f2a-9c1e-4c5d-8a4f-6e7d9c0b1a2b",
    resourceType: null,
    resourceSerial: null,
    requestSerial: null,
    payload: { from: "6281234567890", type: "text", text: { body: "Hello" } },
    createdAt: "2026-08-18T09:41:20.000Z",
  },
  {
    serial: "2d8e3c4f-6a7b-4c9d-0e1f-2a3b4c5d6e7f",
    type: "webhook_delivery",
    status: "error",
    phoneNumberId: "108529403728149",
    businessAccountId: "wa_biz_9d3f21",
    summary: "Delivery to https://hooks.example.com/nexus failed (502)",
    jobSerial: null,
    waMessageId: null,
    sourceActivitySerial: "1c7d2b3e-5f6a-4b8c-9d2e-3a4b5c6d7e8f",
    resourceType: "webhook_config",
    resourceSerial: "7a4b9c2e-1d3f-4a5b-8c9d-0e1f2a3b4c5d",
    requestSerial: "bootstrap",
    payload: { url: "https://hooks.example.com/nexus", status: 502 },
    createdAt: "2026-08-18T09:41:18.000Z",
  },
  {
    serial: "3e9f4d5a-7b8c-4d0e-1f2a-3b4c5d6e7f8a",
    type: "whatsapp_event",
    status: "attempted",
    phoneNumberId: "108529403728149",
    businessAccountId: "wa_biz_9d3f21",
    summary: "Outbound send attempt 1/3 queued",
    jobSerial: "6e4a8c21-d0b2-4f7a-9a3d-1c2e5f6a7b8c",
    waMessageId: null,
    sourceActivitySerial: null,
    resourceType: "job",
    resourceSerial: "6e4a8c21-d0b2-4f7a-9a3d-1c2e5f6a7b8c",
    requestSerial: null,
    payload: { attempts: 1, maxAttempts: 3 },
    createdAt: "2026-08-18T09:40:58.000Z",
  },
  {
    serial: "4f0a5e6b-8c9d-4e1f-2a3b-4c5d6e7f8a9b",
    type: "api_request",
    status: "ok",
    phoneNumberId: null,
    businessAccountId: "wa_biz_9d3f21",
    summary: "GET /api/v1/observability",
    jobSerial: null,
    waMessageId: null,
    sourceActivitySerial: null,
    resourceType: null,
    resourceSerial: null,
    requestSerial: "bootstrap",
    payload: { method: "GET", path: "/observability" },
    createdAt: "2026-08-18T09:38:02.000Z",
  },
];

export function getDummyActivity(serial: string): ActivityEvent | undefined {
  return DUMMY_ACTIVITIES.find((a) => a.serial === serial);
}
