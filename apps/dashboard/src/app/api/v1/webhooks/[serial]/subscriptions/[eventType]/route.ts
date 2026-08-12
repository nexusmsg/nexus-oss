/**
 * Route Handler: DELETE /api/v1/webhooks/[serial]/subscriptions/[eventType]
 */

import { NextRequest, NextResponse } from "next/server";
import { composeServices } from "@/lib/api/compose";
import { loadConfig } from "@/lib/api/config";
import { authorizeApi } from "@/lib/api/server-auth";

export const runtime = "nodejs";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ serial: string; eventType: string }> }
) {
  const config = loadConfig();
  if (!(await authorizeApi(req, config.apiAuthToken))) {
    return NextResponse.json({ error: { message: "Invalid OAuth access token", type: "OAuthException", code: 401 } }, { status: 401 });
  }

  const { serial, eventType } = await params;
  const { webhookManagement } = composeServices(config);
  const cfg = await webhookManagement.removeSubscription(serial, eventType);

  if (cfg === null) {
    return NextResponse.json({ error: { message: "Webhook config not found", type: "OAuthException", code: 400 } }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
