/**
 * Route Handler: GET /api/v1/sessions/[serial]/pairing/qr
 *
 * Returns the pairing QR for a session. Accepts an optional `job_serial`
 * query parameter to scope the response to the QR produced by a specific
 * pairing job (avoids stale-QR reads when several pairing jobs overlap on
 * the same session).
 */

import { NextResponse } from "next/server";
import { composeServices } from "@/lib/api/compose";
import { loadConfig } from "@/lib/api/config";
import { authz } from "@/lib/api/authz";
import { time } from "@/lib/api/time";
import { obs } from "@/lib/api/observability-capture";

export const runtime = "nodejs";

export const GET = authz({ scope: "read" })(
  time()(
    obs()(
      async (req, { params, activity }) => {
        const config = loadConfig();
        const { serial } = await params;
        const jobSerial = req.nextUrl.searchParams.get("job_serial") ?? undefined;
        const { sessionService } = composeServices(config);
        const result = await sessionService.getPairingQr(serial, { jobSerial });

        if (result === null) {
          return NextResponse.json({ error: { message: "Session not found", type: "OAuthException", code: 400 } }, { status: 404 });
        }

        if (result.jobSerial !== undefined) {
          activity.setJobSerial(result.jobSerial);
        }
        return NextResponse.json({
          status: result.status,
          qr_code: result.qrCode,
          qr_serial: result.qrSerial,
          expires_at: result.expiresAt,
          ...(result.jobSerial !== undefined && { job_serial: result.jobSerial }),
          ...(result.jobStatus !== undefined && { job_status: result.jobStatus }),
        });
      },
    ),
  ),
);
