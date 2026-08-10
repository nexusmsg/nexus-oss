/**
 * Route Handler: POST /api/internal/v1/heartbeat
 *
 * Touches last_seen_at for a session. Used by the worker to indicate the
 * device is still connected.
 */

import { NextRequest, NextResponse } from "next/server";
import { composeServices } from "@/lib/api/compose";
import { loadConfig } from "@/lib/api/config";
import { authorizeInternal } from "@/lib/api/server-auth";
import { ValidationError } from "@/lib/api/domain/errors";

export const runtime = "nodejs";

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export async function POST(req: NextRequest) {
  const config = loadConfig();

  if (config.internalToken === "") {
    console.warn("[waba-api] INTERNAL_TOKEN is not set; /internal/v1 routes are disabled");
  }

  if (!authorizeInternal(req)) {
    return NextResponse.json({ error: { message: "Invalid OAuth access token", type: "OAuthException", code: 401 } }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid request body", type: "OAuthException", code: 400 } }, { status: 400 });
  }

  try {
    const { sessionService } = composeServices(config);
    await sessionService.heartbeat(asString(body.phone_number_id) ?? "");
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: { message: err.message, type: "OAuthException", code: 400 } }, { status: 400 });
    }
    throw err;
  }
}
