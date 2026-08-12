/**
 * Authorization helpers for Next.js Route Handlers (server-side).
 *
 * API-5a: public `/api/v1/**` routes authenticate through the async
 * `authorizeApi` authorizer. It currently accepts only the bootstrap
 * `API_AUTH_TOKEN` (Bearer); persisted-key lookup and scope enforcement are
 * API-5b. Internal `/internal/**` routes use the strictly separate
 * `authorizeInternal`, which accepts only `INTERNAL_TOKEN` — bootstrap and
 * persisted credentials never authorize internal routes.
 *
 * All token comparisons are constant-time: both sides are SHA-256 hashed and
 * the fixed-size digests are compared with `timingSafeEqual`, so neither the
 * token length nor the comparison result leaks through timing.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";

/** Constant-time equality of two secrets, including empty/non-empty pairs. */
export function safeEqual(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a).digest();
  const digestB = createHash("sha256").update(b).digest();
  return timingSafeEqual(digestA, digestB);
}

/** The raw credential from `Authorization: Bearer <credential>`, or null. */
export function bearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

/**
 * Async public API authorizer. Currently authenticates only the bootstrap
 * `API_AUTH_TOKEN` with a constant-time comparison. An empty configured token
 * closes public routes: every `/api/v1/**` request is unauthorized.
 */
export async function authorizeApi(
  req: NextRequest,
  token: string,
): Promise<boolean> {
  if (token === "") return false;
  const candidate = bearerToken(req);
  if (candidate === null) return false;
  return safeEqual(candidate, token);
}

/**
 * Strictly separate internal authorizer. Accepts only `INTERNAL_TOKEN`;
 * `API_AUTH_TOKEN` and persisted API keys are never accepted here. Closed when
 * the token is unset.
 */
export function authorizeInternal(req: NextRequest): boolean {
  const token = process.env.INTERNAL_TOKEN ?? "";
  if (token === "") return false;
  const candidate = bearerToken(req);
  if (candidate === null) return false;
  return safeEqual(candidate, token);
}
