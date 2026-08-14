/**
 * Route Handler: POST /api/v1/sessions/[serial]/logout
 */

import { NextRequest, NextResponse } from "next/server";
import { composeServices } from "@/lib/api/compose";
import { loadConfig } from "@/lib/api/config";
import { withApiActivity } from "@/lib/api/observability-capture";

export const runtime = "nodejs";

export const POST = withApiActivity({
  requiredScope: "write",
  handler: async (req, { params, activity }) => {
    const config = loadConfig();
    const { serial } = await params;
    const { sessionService } = composeServices(config);
    const result = await sessionService.startLogout(serial);

    if (result === null) {
      return NextResponse.json({ error: { message: "Session not found", type: "OAuthException", code: 400 } }, { status: 404 });
    }

    activity.setJobSerial(result.jobSerial);
    return NextResponse.json({ job_serial: result.jobSerial }, { status: 202 });
  },
});
