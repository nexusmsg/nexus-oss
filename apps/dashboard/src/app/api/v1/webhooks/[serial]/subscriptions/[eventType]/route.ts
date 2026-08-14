/**
 * Route Handler: DELETE /api/v1/webhooks/[serial]/subscriptions/[eventType]
 */

import { NextRequest, NextResponse } from "next/server";
import { composeServices } from "@/lib/api/compose";
import { loadConfig } from "@/lib/api/config";
import { withApiActivity } from "@/lib/api/observability-capture";

export const runtime = "nodejs";

export const DELETE = withApiActivity({
  requiredScope: "write",
  handler: async (req, { params }) => {
    const config = loadConfig();
    const { serial, eventType } = await params;
    const { webhookManagement } = composeServices(config);
    const cfg = await webhookManagement.removeSubscription(serial, eventType);

    if (cfg === null) {
      return NextResponse.json({ error: { message: "Webhook config not found", type: "OAuthException", code: 400 } }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  },
});
