import { NextResponse } from "next/server";

/**
 * WABA-flavored error envelope. Byte-identical JSON to the inline objects the
 * pre-`authz` routes built themselves. When `details` is provided it becomes
 * `error_data.details`, matching the `/api/waba/.../messages` convention.
 */
export function errorEnvelope(message: string, code: number, details?: string) {
  const error: Record<string, unknown> = { message, type: "OAuthException", code };
  if (details !== undefined) {
    error.error_data = { details };
  }
  return NextResponse.json({ error }, { status: code });
}

/** 401 envelope for a missing / wrong / rejected credential (authz short-circuit). */
export function unauthorized() {
  return errorEnvelope("Invalid OAuth access token", 401);
}

/** 500 envelope recorded when a wrapped handler throws (then the error rethrows). */
export function internalError() {
  return errorEnvelope("Internal server error", 500);
}