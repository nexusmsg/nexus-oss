/**
 * Route Handler: GET /api/internal/v1/webhook-config
 *
 * Returns webhook config for a given phone_number_id.
 * Used by the worker to fetch webhook URLs for incoming event forwarding.
 */

import { NextRequest, NextResponse } from "next/server";
import { composeServices } from "@/lib/api/compose";
import { loadConfig } from "@/lib/api/config";
import { authorizeInternal } from "@/lib/api/server-auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const config = loadConfig();

  if (config.internalToken === "") {
    console.warn("[waba-api] INTERNAL_TOKEN is not set; /internal/v1 routes are disabled");
  }

  if (!authorizeInternal(req)) {
    return NextResponse.json({ error: { message: "Invalid OAuth access token", type: "OAuthException", code: 401 } }, { status: 401 });
  }

  const phoneNumberId = req.nextUrl.searchParams.get("phone_number_id");
  if (!phoneNumberId || phoneNumberId === "") {
    return NextResponse.json({ error: { message: "phone_number_id is required", type: "OAuthException", code: 400 } }, { status: 400 });
  }

  try {
    const { webhookConfig } = composeServices(config);
    const cfg = await webhookConfig.get(phoneNumberId);

    if (cfg === null) {
      return NextResponse.json({ error: { message: "Webhook config not found", type: "OAuthException", code: 400 } }, { status: 404 });
    }

    return NextResponse.json({
      webhook_url: cfg.webhookUrl,
      webhook_secret: cfg.webhookSecret,
    });
  } catch {
    return NextResponse.json({ error: { message: "Internal server error", type: "OAuthException", code: 500 } }, { status: 500 });
  }
}
