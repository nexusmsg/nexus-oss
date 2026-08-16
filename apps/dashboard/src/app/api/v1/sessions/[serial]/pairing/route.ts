/**
 * Route Handler: POST /api/v1/sessions/[serial]/pairing
 */

import { NextResponse } from "next/server";
import { composeServices } from "@/lib/api/compose";
import { loadConfig } from "@/lib/api/config";
import { authz } from "@/lib/api/authz";
import { time } from "@/lib/api/time";
import { obs } from "@/lib/api/observability-capture";

export const runtime = "nodejs";

export const POST = authz({ scope: "write" })(
  time()(
    obs()(
      async (req, { params, activity }) => {
        const config = loadConfig();
        const { serial } = await params;
        const { sessionService } = composeServices(config);
        const result = await sessionService.startPairing(serial);

        if (result === null) {
          return NextResponse.json({ error: { message: "Session not found", type: "OAuthException", code: 400 } }, { status: 404 });
        }

        activity.setJobSerial(result.jobSerial);
        return NextResponse.json({ job_serial: result.jobSerial }, { status: 202 });
      },
    ),
  ),
);
