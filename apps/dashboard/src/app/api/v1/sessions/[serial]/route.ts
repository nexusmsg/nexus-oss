/**
 * Route Handler: GET, DELETE /api/v1/sessions/[serial]
 */

import { NextRequest, NextResponse } from "next/server";
import { composeServices } from "@/lib/api/compose";
import { loadConfig } from "@/lib/api/config";
import { authorizeApi } from "@/lib/api/server-auth";
import type { Session } from "@/lib/api/domain/session";

export const runtime = "nodejs";

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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ serial: string }> }
) {
  const config = loadConfig();
  if (!(await authorizeApi(req, config.apiAuthToken, {
    requiredScope: "read",
    getPersistedKeys: () => composeServices(config).apiKeyAuth,
  }))) {
    return NextResponse.json({ error: { message: "Invalid OAuth access token", type: "OAuthException", code: 401 } }, { status: 401 });
  }

  const { serial } = await params;
  const { sessionService } = composeServices(config);
  const session = await sessionService.getSession(serial);

  if (session === null) {
    return NextResponse.json({ error: { message: "Session not found", type: "OAuthException", code: 400 } }, { status: 404 });
  }

  return NextResponse.json(toSessionJson(session));
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ serial: string }> },
) {
  const config = loadConfig();
  if (!(await authorizeApi(req, config.apiAuthToken, {
    requiredScope: "write",
    getPersistedKeys: () => composeServices(config).apiKeyAuth,
  }))) {
    return NextResponse.json({ error: { message: "Invalid OAuth access token", type: "OAuthException", code: 401 } }, { status: 401 });
  }

  const { serial } = await params;
  const { sessionService } = composeServices(config);
  const deleted = await sessionService.deleteSession(serial);
  if (!deleted) {
    return NextResponse.json({ error: { message: "Session not found", type: "OAuthException", code: 400 } }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}
