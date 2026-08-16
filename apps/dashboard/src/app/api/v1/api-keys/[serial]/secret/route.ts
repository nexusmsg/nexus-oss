/**
 * Route Handler: GET /api/v1/api-keys/[serial]/secret
 *
 * On-demand reveal: server-side decryption of the plaintext API-key secret for
 * a non-deleted key. The encryption key never leaves the server; the plaintext
 * is returned only over this authenticated route.
 *
 * Management routes are bootstrap-only (`API_AUTH_TOKEN`); persisted keys can
 * never call them. Error mapping:
 * - 401  missing/wrong bootstrap token (or the token is globally unset)
 * - 404  serial unknown
 * - 409  key is revoked (reveal is blocked server-side, not just in the UI)
 * - 410  key predates ciphertext storage (`key_ciphertext` is NULL)
 * - 429  per-serial reveal rate limit exceeded
 * - 500  decryption/config failure (generic body; details server-side only)
 *
 * Successful and not-recoverable reveals emit a structured audit line. The
 * plaintext secret is NEVER logged.
 */

import { NextResponse } from "next/server";
import { composeServices } from "@/lib/api/compose";
import { loadConfig } from "@/lib/api/config";
import {
  ApiKeyRevokedError,
  KeyEncryptionNotConfiguredError,
  KeySecretDecryptionError,
  KeySecretNotRecoverableError,
} from "@/lib/api/domain/errors";
import { authz } from "@/lib/api/authz";
import { time } from "@/lib/api/time";
import { obs } from "@/lib/api/observability-capture";

export const runtime = "nodejs";

/** Max reveals per serial per window; the reveal route is the crown jewels. */
const REVEAL_LIMIT = 10;
const REVEAL_WINDOW_MS = 5 * 60 * 1000;
const revealTimestamps = new Map<string, number[]>();

/**
 * Basic in-memory per-serial rate limit. Returns true when the call is allowed
 * and records it; false when the serial is over the window limit.
 */
function allowReveal(serial: string): boolean {
  const now = Date.now();
  const recent = (revealTimestamps.get(serial) ?? []).filter(
    (t) => now - t < REVEAL_WINDOW_MS,
  );
  if (recent.length >= REVEAL_LIMIT) {
    revealTimestamps.set(serial, recent);
    return false;
  }
  recent.push(now);
  revealTimestamps.set(serial, recent);
  return true;
}

/** Structured audit line; never contains the secret. */
function auditReveal(serial: string, outcome: string): void {
  console.log(
    JSON.stringify({
      event: "api_key.reveal",
      serial,
      outcome,
      ts: new Date().toISOString(),
    }),
  );
}

export const GET = authz({ scope: "write", bootstrapOnly: true })(
  time()(
    obs({ captureResponse: false })(
      // The response body carries the plaintext API-key secret; never capture it
      // (R7 — no tokens in the activity log). The request is still captured.
      async (req, { params }) => {
        const config = loadConfig();
        const { serial } = await params;

        if (!allowReveal(serial)) {
          return NextResponse.json(
            { error: { message: "Too many requests", type: "OAuthException", code: 429 } },
            { status: 429 },
          );
        }

        const { apiKeys } = composeServices(config);

        try {
          const revealed = await apiKeys.revealKey(serial);
          if (revealed === null) {
            return NextResponse.json(
              { error: { message: "API key not found", type: "OAuthException", code: 400 } },
              { status: 404 },
            );
          }
          auditReveal(serial, "revealed");
          return NextResponse.json({ secret: revealed.secret });
        } catch (error) {
          if (error instanceof ApiKeyRevokedError) {
            return NextResponse.json(
              { error: { message: "API key is revoked", type: "OAuthException", code: 409 } },
              { status: 409 },
            );
          }
          if (error instanceof KeySecretNotRecoverableError) {
            auditReveal(serial, "not_recoverable");
            return NextResponse.json(
              { error: { message: "secret is not recoverable for this key", type: "OAuthException", code: 410 } },
              { status: 410 },
            );
          }
          if (
            error instanceof KeyEncryptionNotConfiguredError ||
            error instanceof KeySecretDecryptionError
          ) {
            console.error("api_key reveal failed", { serial, error: error.message });
            return NextResponse.json(
              { error: { message: "Unable to reveal API key", type: "OAuthException", code: 500 } },
              { status: 500 },
            );
          }
          throw error;
        }
      },
    ),
  ),
);
