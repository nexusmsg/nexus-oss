/**
 * Route Handler: GET /api/v1/sessions, POST /api/v1/sessions
 */

import { NextRequest, NextResponse } from "next/server";
import { composeServices } from "@/lib/api/compose";
import { loadConfig } from "@/lib/api/config";
import { authorizeBearer } from "@/lib/api/server-auth";
import { ValidationError } from "@/lib/api/domain/errors";
import type { Session } from "@/lib/api/domain/session";

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

export async function GET(req: NextRequest) {
  const config = loadConfig();
  if (!authorizeBearer(req, config.apiAuthToken)) {
    return NextResponse.json({ error: { message: "Invalid OAuth access token", type: "OAuthException", code: 401 } }, { status: 401 });
  }

  const { sessionService } = composeServices(config);
  const sessions = await sessionService.listSessions();
  return NextResponse.json({ sessions: sessions.map(toSessionJson) });
}

export async function POST(req: NextRequest) {
  const config = loadConfig();
  if (!authorizeBearer(req, config.apiAuthToken)) {
    return NextResponse.json({ error: { message: "Invalid OAuth access token", type: "OAuthException", code: 401 } }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid request body", type: "OAuthException", code: 400 } }, { status: 400 });
  }

  try {
    const { sessionService } = composeServices(config);
    const session = await sessionService.createSession({
      phoneNumberId: asString(body.phone_number_id) ?? "",
      number: asString(body.number) ?? "",
      displayPhone: asString(body.display_phone) ?? undefined,
      businessAccountId: asString(body.business_account_id) ?? undefined,
    });
    return NextResponse.json(toSessionJson(session), { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: { message: err.message, type: "OAuthException", code: 400 } }, { status: 400 });
    }
    throw err;
  }
}
