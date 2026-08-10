/**
 * Bearer / Basic auth helpers for the HTTP adapter.
 *
 * Both schemes authenticate against the same shared secret. For Basic auth the
 * *password* must equal the expected token; the username is free-form (e.g.
 * `nexus`).
 */

import { timingSafeEqual } from "node:crypto";
import type { Context } from "hono";

const BEARER_PREFIX = "Bearer ";
const BASIC_PREFIX = "Basic ";
/** Matches well-formed base64 (allowing up to two trailing `=` padding). */
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/** Value sent on the `WWW-Authenticate` header of 401 responses. */
export const WWW_AUTHENTICATE_BASIC = 'Basic realm="nexus"';

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
 * Returns the password portion of a Basic auth header value (the substring
 * after the last `:` in the decoded `user:pass`). Returns null for malformed
 * headers (not valid base64, or no `:` after decoding).
 */
function basicPassword(encoded: string): string | null {
  const trimmed = encoded.trim();
  if (trimmed === "" || trimmed.length % 4 === 1 || !BASE64_RE.test(trimmed)) {
    return null;
  }
  let decoded: string;
  try {
    decoded = Buffer.from(trimmed, "base64").toString("utf8");
  } catch {
    return null;
  }
  const colon = decoded.indexOf(":");
  if (colon === -1) {
    return null;
  }
  return decoded.slice(colon + 1);
}

/**
 * Returns true when the request is authorized. An empty `expected` token means
 * auth is disabled and every request is accepted. Accepts either
 * `Authorization: Bearer <expected>` or
 * `Authorization: Basic base64(<user>:<expected>)`; when both schemes are
 * present Bearer takes precedence.
 */
export function authorizeBearer(c: Context, expected: string): boolean {
  if (expected === "") {
    return true;
  }
  const header = c.req.header("Authorization");
  if (header === undefined || header === "") {
    return false;
  }
  if (header.startsWith(BEARER_PREFIX)) {
    return safeEqual(header.slice(BEARER_PREFIX.length), expected);
  }
  if (header.startsWith(BASIC_PREFIX)) {
    const password = basicPassword(header.slice(BASIC_PREFIX.length));
    if (password === null) {
      return false;
    }
    return safeEqual(password, expected);
  }
  return false;
}
