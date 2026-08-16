/**
 * Route Handler: GET, DELETE /api/v1/sessions/[serial]
 */

import { NextResponse } from "next/server";
import { composeServices } from "@/lib/api/compose";
import { loadConfig } from "@/lib/api/config";
import { authz } from "@/lib/api/authz";
import { time } from "@/lib/api/time";
import { obs } from "@/lib/api/observability-capture";
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

export const GET = authz({ scope: "read" })(
  time()(
    obs()(
      async (req, { params }) => {
        const config = loadConfig();
        const { serial } = await params;
        const { sessionService } = composeServices(config);
        const session = await sessionService.getSession(serial);

        if (session === null) {
          return NextResponse.json({ error: { message: "Session not found", type: "OAuthException", code: 400 } }, { status: 404 });
        }

        return NextResponse.json(toSessionJson(session));
      },
    ),
  ),
);

export const DELETE = authz({ scope: "write" })(
  time()(
    obs()(
      async (req, { params }) => {
        const config = loadConfig();
        const { serial } = await params;
        const { sessionService } = composeServices(config);
        const deleted = await sessionService.deleteSession(serial);
        if (!deleted) {
          return NextResponse.json({ error: { message: "Session not found", type: "OAuthException", code: 400 } }, { status: 404 });
        }
        return new NextResponse(null, { status: 204 });
      },
    ),
  ),
);
