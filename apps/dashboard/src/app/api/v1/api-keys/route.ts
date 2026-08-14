/**
 * Route Handler: GET /api/v1/api-keys, POST /api/v1/api-keys
 *
 * Management routes are authorized only by the bootstrap `API_AUTH_TOKEN`
 * (Bearer). Persisted keys are real additive credentials but are NOT yet
 * valid for this phase (API-5b) and can never call management routes.
 *
 * The plaintext secret is returned only from the create response; list/get/
 * update/revoke responses are redacted (no secret, no SHA-256 hash).
 */

import { NextRequest, NextResponse } from "next/server";
import { composeServices } from "@/lib/api/compose";
import { loadConfig } from "@/lib/api/config";
import { ValidationError } from "@/lib/api/domain/errors";
import type { ApiKeyScope } from "@/lib/api/domain/api-key";
import type { RedactedApiKey } from "@/lib/api/service/api-key-management";
import { withApiActivity } from "@/lib/api/observability-capture";

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

export const GET = withApiActivity({
  requiredScope: "read",
  bootstrapOnly: true,
  handler: async (req) => {
    const config = loadConfig();
    const { apiKeys } = composeServices(config);
    const keys = await apiKeys.listKeys();
    return NextResponse.json({ api_keys: keys.map(toApiKeyJson) });
  },
});

export const POST = withApiActivity({
  requiredScope: "write",
  bootstrapOnly: true,
  handler: async (req) => {
    const config = loadConfig();

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: { message: "Invalid request body", type: "OAuthException", code: 400 } }, { status: 400 });
    }

    try {
      const scope = asScope(body.scope);
      if (scope === undefined) {
        throw new ValidationError("scope must be one of: read, write, full");
      }
      const { apiKeys } = composeServices(config);
      const { key, secret } = await apiKeys.createKey({
        name: asString(body.name) ?? "",
        scope,
        expiresAt: asString(body.expires_at) ?? undefined,
      });
      return NextResponse.json({ key: toApiKeyJson(key), secret }, { status: 201 });
    } catch (err) {
      if (err instanceof ValidationError) {
        return NextResponse.json({ error: { message: err.message, type: "OAuthException", code: 400 } }, { status: 400 });
      }
      throw err;
    }
  },
});
