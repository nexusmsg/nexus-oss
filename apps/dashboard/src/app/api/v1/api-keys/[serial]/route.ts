/**
 * Route Handler: GET /api/v1/api-keys/[serial], PATCH /api/v1/api-keys/[serial], DELETE /api/v1/api-keys/[serial]
 *
 * Management routes are authorized only by the bootstrap `API_AUTH_TOKEN`
 * (Bearer). Persisted keys are real additive credentials but are NOT yet
 * valid for this phase (API-5b) and can never call management routes.
 *
 * All responses are redacted (no secret, no SHA-256 hash). `DELETE` maps to
 * `revokeKey` (keys are revoked, never hard-deleted).
 */

import { NextRequest, NextResponse } from "next/server";
import { composeServices } from "@/lib/api/compose";
import { loadConfig } from "@/lib/api/config";
import { ValidationError } from "@/lib/api/domain/errors";
import { authorizeBearer } from "@/lib/api/server-auth";
import type { ApiKeyScope } from "@/lib/api/domain/api-key";
import type { RedactedApiKey } from "@/lib/api/service/api-key-management";

export const runtime = "nodejs";

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asScope(value: unknown): ApiKeyScope | undefined {
  return value === "read" || value === "write" || value === "full" ? value : undefined;
}

/** Redacted management view → wire shape. Never includes the secret or hash. */
function toApiKeyJson(key: RedactedApiKey) {
  return {
    serial: key.serial,
    name: key.name,
    key_prefix: key.keyPrefix,
    scope: key.scope,
    status: key.status,
    expires_at: key.expiresAt,
    last_used_at: key.lastUsedAt,
    created_at: key.createdAt,
    updated_at: key.updatedAt,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ serial: string }> }
) {
  const config = loadConfig();
  if (!authorizeBearer(req, config.apiAuthToken)) {
    return NextResponse.json({ error: { message: "Invalid OAuth access token", type: "OAuthException", code: 401 } }, { status: 401 });
  }

  const { serial } = await params;
  const { apiKeys } = composeServices(config);
  const key = await apiKeys.getKey(serial);

  if (key === null) {
    return NextResponse.json({ error: { message: "API key not found", type: "OAuthException", code: 400 } }, { status: 404 });
  }

  return NextResponse.json(toApiKeyJson(key));
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ serial: string }> }
) {
  const config = loadConfig();
  if (!authorizeBearer(req, config.apiAuthToken)) {
    return NextResponse.json({ error: { message: "Invalid OAuth access token", type: "OAuthException", code: 401 } }, { status: 401 });
  }

  const { serial } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid request body", type: "OAuthException", code: 400 } }, { status: 400 });
  }

  try {
    const { apiKeys } = composeServices(config);
    const key = await apiKeys.updateKey(serial, {
      name: asString(body.name) ?? undefined,
      scope: asScope(body.scope),
      expiresAt:
        body.expires_at === null ? null : asString(body.expires_at) ?? undefined,
    });

    if (key === null) {
      return NextResponse.json({ error: { message: "API key not found", type: "OAuthException", code: 400 } }, { status: 404 });
    }

    return NextResponse.json(toApiKeyJson(key));
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: { message: err.message, type: "OAuthException", code: 400 } }, { status: 400 });
    }
    throw err;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ serial: string }> }
) {
  const config = loadConfig();
  if (!authorizeBearer(req, config.apiAuthToken)) {
    return NextResponse.json({ error: { message: "Invalid OAuth access token", type: "OAuthException", code: 401 } }, { status: 401 });
  }

  const { serial } = await params;
  const { apiKeys } = composeServices(config);
  const key = await apiKeys.revokeKey(serial);

  if (key === null) {
    return NextResponse.json({ error: { message: "API key not found", type: "OAuthException", code: 400 } }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
