/**
 * Route Handler: GET /api/v1/sessions/[serial]/status
 */

import { NextRequest, NextResponse } from "next/server";
import { composeServices } from "@/lib/api/compose";
import { loadConfig } from "@/lib/api/config";
import { withApiActivity } from "@/lib/api/observability-capture";

export const runtime = "nodejs";

export const GET = withApiActivity({
  requiredScope: "read",
  handler: async (req, { params }) => {
    const config = loadConfig();
    const { serial } = await params;
    const { sessionService } = composeServices(config);
    const result = await sessionService.getStatus(serial);

    if (result === null) {
      return NextResponse.json({ error: { message: "Session not found", type: "OAuthException", code: 400 } }, { status: 404 });
    }

    return NextResponse.json(result);
  },
});
