/**
 * Route Handler: GET /api/v1/observability/[serial]
 *
 * Management-style detail route for the developer activity log (observability
 * plan T6). Authorized only by the bootstrap `API_AUTH_TOKEN` (Bearer);
 * persisted API keys are REJECTED (bootstrap-only, mirroring
 * `/api/v1/api-keys`).
 *
 * Returns `{ activity, related }` ({@link ActivityDetailResponse}); a 404
 * envelope when the serial is unknown.
 */

import { NextRequest, NextResponse } from "next/server";
import { composeServices } from "@/lib/api/compose";
import { loadConfig } from "@/lib/api/config";
import { authorizeApi } from "@/lib/api/server-auth";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ serial: string }> },
) {
  const config = loadConfig();
  if (!(await authorizeApi(req, config.apiAuthToken, { requiredScope: "read" }))) {
    return NextResponse.json(
      { error: { message: "Invalid OAuth access token", type: "OAuthException", code: 401 } },
      { status: 401 },
    );
  }

  const { serial } = await params;
  const { observability } = composeServices(config);
  const detail = await observability.detail(serial);

  if (detail === null) {
    return NextResponse.json(
      { error: { message: "Activity not found", type: "OAuthException", code: 404 } },
      { status: 404 },
    );
  }

  return NextResponse.json({ activity: detail.activity, related: detail.related });
}
