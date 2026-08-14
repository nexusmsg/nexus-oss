/**
 * Authorization helpers for Next.js Route Handlers (server-side).
 *
 * API-5b: the async `authorizeApi` authorizer accepts two credential classes:
 *
 *  1. The bootstrap `API_AUTH_TOKEN` (Bearer), verified with a constant-time
 *     SHA-256 comparison. Bootstrap auth bypasses scope checks.
 *  2. Persisted API keys, looked up by SHA-256 hex digest of the full Bearer
 *     credential via `ApiKeyAuthPort.getKeyByHash`. Unknown, revoked,
 *     soft-deleted, and expired keys are rejected; the route's `requiredScope`
 *     is enforced (`read` for GET, `write` for POST/PATCH/DELETE, `full`
 *     grants both). A successful persisted-key auth triggers a best-effort,
 *     throttled `last_used_at` update (at most once per key per five minutes)
 *     that is non-blocking and never rejects unhandled.
 *
 * Management routes (`/api/v1/api-keys/**`) call `authorizeApi` without a
 * persisted-key accessor, making them bootstrap-only: persisted keys never
 * authorize them and no hash lookup is attempted.
 *
 * Internal `/internal/**` routes use the strictly separate `authorizeInternal`,
 * which accepts only `INTERNAL_TOKEN` — bootstrap and persisted credentials
 * never authorize internal routes.
 *
 * When `API_AUTH_TOKEN` is empty, every public route is closed (API-5a
 * parity): neither bootstrap nor persisted-key credentials are accepted.
 *
 * All token comparisons are constant-time: both sides are SHA-256 hashed and
 * the fixed-size digests are compared with `timingSafeEqual`, so neither the
 * token length nor the comparison result leaks through timing.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { LAST_USED_THROTTLE_MS } from "./domain/api-key";
import type { ApiKey, ApiKeyScope } from "./domain/api-key";
import type { ApiKeyTransport } from "./ports/api-key-transport";
import { hashApiKeySecret } from "./service/api-key-management";

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
 * Persisted-key capability the public authorizer needs from the composition
 * root: SHA-256 hash lookup plus a best-effort, throttled `last_used_at`
 * update. `DrizzleTransport` satisfies this structurally.
 */
export type ApiKeyAuthPort = Pick<
  ApiKeyTransport,
  "getKeyByHash" | "touchKeyLastUsed"
>;

/** Scope a route demands from a persisted key. GET routes → `read`; mutations → `write`. */
export type RequiredApiKeyScope = "read" | "write";

export interface AuthorizeApiOptions {
  /**
   * The scope a persisted key must grant for this route. Bootstrap auth
   * bypasses scope checks. `full` grants both `read` and `write`.
   */
  requiredScope: RequiredApiKeyScope;
  /**
   * Lazy accessor for the persisted-key auth port, invoked only when a
   * persisted-key lookup is warranted (bootstrap mismatch with a plausible
   * `waba_…` key-shaped credential). Omit for management routes: they are
   * bootstrap-only and persisted keys never authorize them.
   */
  getPersistedKeys?: () => ApiKeyAuthPort;
}

/** Generated persisted keys always start with this literal prefix. */
const PERSISTED_KEY_PREFIX = "waba_";

/**
 * Async public API authorizer (API-5b). Accepts the bootstrap token
 * (constant-time, scope-bypassing) or a valid persisted API key (hash lookup
 * with lifecycle + scope enforcement). An empty configured token closes every
 * public route. Fail-closed: any persisted-key lookup error is treated as
 * unauthorized.
 */
export async function authorizeApi(
  req: NextRequest,
  token: string,
  options: AuthorizeApiOptions,
): Promise<boolean> {
  if (token === "") return false;
  const candidate = bearerToken(req);
  if (candidate === null) return false;
  if (safeEqual(candidate, token)) return true;

  const getPersistedKeys = options.getPersistedKeys;
  if (getPersistedKeys === undefined) return false;
  if (!candidate.startsWith(PERSISTED_KEY_PREFIX)) return false;

  let persistedKeys: ApiKeyAuthPort;
  try {
    persistedKeys = getPersistedKeys();
  } catch {
    return false;
  }

  let key: ApiKey | null;
  try {
    key = await persistedKeys.getKeyByHash(hashApiKeySecret(candidate));
  } catch {
    return false;
  }
  // null = unknown or soft-deleted (the adapter excludes soft-deleted rows).
  if (key === null) return false;
  // Only `active` keys authenticate; `revoked` keys are rejected.
  if (key.status !== "active") return false;
  // Expired keys are rejected; `null` = never expires.
  if (key.expiresAt !== null && Date.parse(key.expiresAt) <= Date.now()) {
    return false;
  }
  if (!scopeAllows(key.scope, options.requiredScope)) return false;

  touchLastUsedBestEffort(persistedKeys, key);
  return true;
}

/**
 * Best-effort `last_used_at` update after successful persisted-key auth.
 * Non-blocking and never rejects: a failed write must not fail the request.
 * Throttled to at most once per key per five minutes; the adapter additionally
 * guards the write so concurrent requests cannot bypass the window.
 */
function touchLastUsedBestEffort(persistedKeys: ApiKeyAuthPort, key: ApiKey): void {
  const last = key.lastUsedAt === null ? null : Date.parse(key.lastUsedAt);
  if (last !== null && Date.now() - last < LAST_USED_THROTTLE_MS) return;
  try {
    void persistedKeys.touchKeyLastUsed(key.serial).catch(() => undefined);
  } catch {
    // Synchronous throw from the port: ignore; auth already succeeded.
  }
}

/**
 * Identity result returned by `authorizeApiWithIdentity`. `authorized` mirrors
 * `authorizeApi`; `identity` is the resolved principal — the api key `serial`
 * for a persisted-key authorization, the literal `"bootstrap"` when the
 * bootstrap token matched, or `null` when unauthorized.
 */
export interface AuthorizeApiIdentity {
  authorized: boolean;
  identity: string | null;
}

/**
 * Sibling of `authorizeApi` (plan §10 R1) that additionally resolves the
 * authenticated identity. Added — not a change to `authorizeApi`'s ~57 call
 * sites — for the future capture wrapper (T7), which needs the principal to
 * populate `request_serial`. Reuses the exact bootstrap / persisted-key logic
 * from `authorizeApi`; `identity` is `null` unless `authorized` is true.
 */
export async function authorizeApiWithIdentity(
  req: NextRequest,
  token: string,
  options: AuthorizeApiOptions,
): Promise<AuthorizeApiIdentity> {
  if (token === "") return { authorized: false, identity: null };
  const candidate = bearerToken(req);
  if (candidate === null) return { authorized: false, identity: null };
  if (safeEqual(candidate, token)) return { authorized: true, identity: "bootstrap" };

  const getPersistedKeys = options.getPersistedKeys;
  if (getPersistedKeys === undefined) return { authorized: false, identity: null };
  if (!candidate.startsWith(PERSISTED_KEY_PREFIX)) return { authorized: false, identity: null };

  let persistedKeys: ApiKeyAuthPort;
  try {
    persistedKeys = getPersistedKeys();
  } catch {
    return { authorized: false, identity: null };
  }

  let key: ApiKey | null;
  try {
    key = await persistedKeys.getKeyByHash(hashApiKeySecret(candidate));
  } catch {
    return { authorized: false, identity: null };
  }
  // null = unknown or soft-deleted (the adapter excludes soft-deleted rows).
  if (key === null) return { authorized: false, identity: null };
  // Only `active` keys authenticate; `revoked` keys are rejected.
  if (key.status !== "active") return { authorized: false, identity: null };
  // Expired keys are rejected; `null` = never expires.
  if (key.expiresAt !== null && Date.parse(key.expiresAt) <= Date.now()) {
    return { authorized: false, identity: null };
  }
  if (!scopeAllows(key.scope, options.requiredScope)) return { authorized: false, identity: null };

  touchLastUsedBestEffort(persistedKeys, key);
  return { authorized: true, identity: key.serial };
}

/** `full` grants both scopes; otherwise the key's scope must equal the requirement. */
function scopeAllows(scope: ApiKeyScope, required: RequiredApiKeyScope): boolean {
  if (scope === "full") return true;
  return scope === required;
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
