/**
 * Route Handler: GET /api/v1/sessions, POST /api/v1/sessions
 */

import { NextRequest, NextResponse } from "next/server";
import { composeServices } from "@/lib/api/compose";
import { loadConfig } from "@/lib/api/config";
import { ValidationError } from "@/lib/api/domain/errors";
import type { Session } from "@/lib/api/domain/session";
import { withApiActivity } from "@/lib/api/observability-capture";

export const runtime = "nodejs";

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toSessionJson(session: Session) {
  return {
    id: session.serial,
    phone_number_id: session.phoneNumberId,
    number: session.number,
    display_phone: session.displayPhone,
    business_account_id: session.businessAccountId,
    status: session.status,
    whatsapp_id: session.whatsappId,
    connected_at: session.connectedAt,
    last_seen_at: session.lastSeenAt,
    logged_out_at: session.loggedOutAt,
    created_at: session.createdAt,
  };
}

export const GET = withApiActivity({
  requiredScope: "read",
  handler: async (req) => {
    const config = loadConfig();
    const { sessionService } = composeServices(config);
    const sessions = await sessionService.listSessions();
    return NextResponse.json({ sessions: sessions.map(toSessionJson) });
  },
});

export const POST = withApiActivity({
  requiredScope: "write",
  handler: async (req) => {
    const config = loadConfig();
    const { sessionService } = composeServices(config);
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: { message: "Invalid request body", type: "OAuthException", code: 400 } }, { status: 400 });
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: { message: "Invalid request body", type: "OAuthException", code: 400 } }, { status: 400 });
    }
    const record = body as Record<string, unknown>;
    const phoneNumberId = asString(record.phone_number_id);
    if (phoneNumberId === null) {
      return NextResponse.json({ error: { message: "phone_number_id is required", type: "OAuthException", code: 400 } }, { status: 400 });
    }
    try {
      const session = await sessionService.createSession({
        phoneNumberId,
        number: asString(record.number) ?? "",
        displayPhone: asString(record.display_phone) ?? "",
        businessAccountId: asString(record.business_account_id) ?? "",
      });
      return NextResponse.json(toSessionJson(session), { status: 201 });
    } catch (err) {
      if (err instanceof ValidationError) {
        return NextResponse.json({ error: { message: err.message, type: "OAuthException", code: 400 } }, { status: 400 });
      }
      throw err;
    }
  },
});
