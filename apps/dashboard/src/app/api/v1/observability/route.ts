/**
 * Route Handler: GET /api/v1/observability
 *
 * Management-style route for the developer activity log (see observability
 * plan T6). Authorized only by the bootstrap `API_AUTH_TOKEN` (Bearer);
 * persisted API keys are REJECTED (bootstrap-only, mirroring
 * `/api/v1/api-keys`). No persisted-key accessor is passed to `authorizeApi`,
 * so no hash lookup is attempted and persisted keys never authorize this route.
 *
 * Returns the list envelope `{ activities: ActivityEventView[] }` newest-first.
 * Query filters: `type`, `status`, `phone_number_id` (exact), and `limit`.
 */

import { NextRequest, NextResponse } from "next/server";
import { composeServices } from "@/lib/api/compose";
import { loadConfig } from "@/lib/api/config";
import { ValidationError } from "@/lib/api/domain/errors";
import { authorizeApi } from "@/lib/api/server-auth";
import type {
  ActivityListFilters,
  ActivityType,
  ActivityStatus,
} from "@/lib/api/domain/observability";

export const runtime = "nodejs";

function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function asActivityType(value: unknown): ActivityType | undefined {
  return value === "api_request" || value === "whatsapp_event" || value === "webhook_delivery"
    ? value
    : undefined;
}

function asActivityStatus(value: unknown): ActivityStatus | undefined {
  return value === "ok" || value === "error" || value === "attempted" ? value : undefined;
}

/** Parse list filters from the query string into the service filter shape. */
function parseFilters(req: NextRequest): ActivityListFilters {
  const sp = req.nextUrl.searchParams;

  const typeRaw = asString(sp.get("type"));
  const statusRaw = asString(sp.get("status"));
  const phoneRaw = asString(sp.get("phone_number_id"));

  // Validate discriminator values; reject unknown values with a 400 so the
  // client gets a precise error rather than a silently ignored filter.
  if (typeRaw !== null && asActivityType(typeRaw) === undefined) {
    throw new ValidationError(
      "type must be one of: api_request, whatsapp_event, webhook_delivery",
    );
  }
  if (statusRaw !== null && asActivityStatus(statusRaw) === undefined) {
    throw new ValidationError("status must be one of: ok, error, attempted");
  }

  const limitRaw = asString(sp.get("limit"));
  let limit: number | undefined;
  if (limitRaw !== null) {
    const parsed = Number(limitRaw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new ValidationError("limit must be a positive integer");
    }
    limit = parsed;
  }

  return {
    type: typeRaw === null ? undefined : (typeRaw as ActivityType),
    status: statusRaw === null ? undefined : (statusRaw as ActivityStatus),
    phoneNumberId: phoneRaw ?? undefined,
    limit,
  };
}

export async function GET(req: NextRequest) {
  const config = loadConfig();
  if (!(await authorizeApi(req, config.apiAuthToken, { requiredScope: "read" }))) {
    return NextResponse.json(
      { error: { message: "Invalid OAuth access token", type: "OAuthException", code: 401 } },
      { status: 401 },
    );
  }

  let filters: ActivityListFilters;
  try {
    filters = parseFilters(req);
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json(
        { error: { message: err.message, type: "OAuthException", code: 400 } },
        { status: 400 },
      );
    }
    throw err;
  }

  const { observability } = composeServices(config);
  const res = await observability.list(filters);
  return NextResponse.json({ activities: res.activities });
}
