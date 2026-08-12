/**
 * Route Handler: POST /api/v1/sessions/[serial]/pairing
 */

import { NextRequest, NextResponse } from "next/server";
import { composeServices } from "@/lib/api/compose";
import { loadConfig } from "@/lib/api/config";
import { authorizeApi } from "@/lib/api/server-auth";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ serial: string }> }
) {
  const config = loadConfig();
  if (!(await authorizeApi(req, config.apiAuthToken))) {
    return NextResponse.json({ error: { message: "Invalid OAuth access token", type: "OAuthException", code: 401 } }, { status: 401 });
  }

  const { serial } = await params;
  const { sessionService } = composeServices(config);
  const result = await sessionService.startPairing(serial);

  if (result === null) {
    return NextResponse.json({ error: { message: "Session not found", type: "OAuthException", code: 400 } }, { status: 404 });
  }

  return NextResponse.json({ job_serial: result.jobSerial }, { status: 202 });
}
