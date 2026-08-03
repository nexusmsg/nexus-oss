/**
 * Bearer auth helpers for the HTTP adapter.
 */

import { timingSafeEqual } from "node:crypto";
import type { Context } from "hono";

const BEARER_PREFIX = "Bearer ";

/** Constant-time string comparison; unequal lengths never compare equal. */
export function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Returns true when the request is authorized. An empty `expected` token means
 * auth is disabled and every request is accepted.
 */
export function authorizeBearer(c: Context, expected: string): boolean {
  if (expected === "") {
    return true;
  }
  const header = c.req.header("Authorization");
  if (header === undefined || !header.startsWith(BEARER_PREFIX)) {
    return false;
  }
  return safeEqual(header.slice(BEARER_PREFIX.length), expected);
}
