/**
 * Route Handler: POST /api/v1/webhooks/[serial]/test
 *
 * One-shot webhook test: sends a deterministic synthetic inbound WABA
 * `messages` payload to the config's webhook URL and returns a structured
 * probe result (endpoint response or failure). Requires bearer auth; the
 * config itself is never persisted or logged.
 */

import { NextResponse } from "next/server";
import { composeServices } from "@/lib/api/compose";
import { loadConfig } from "@/lib/api/config";
import { RequestAbortedError, ValidationError } from "@/lib/api/domain/errors";
import type { WebhookProbeResult } from "@/lib/api/domain/webhook-test";
import { authz } from "@/lib/api/authz";
import { time } from "@/lib/api/time";
import { obs } from "@/lib/api/observability-capture";

export const runtime = "nodejs";

function toWebhookTestJson(result: WebhookProbeResult) {
  return {
    outcome: result.outcome,
    ok: result.ok,
    status: result.status,
    status_text: result.statusText,
    headers: result.headers,
    body: result.body,
    body_truncated: result.bodyTruncated,
    duration_ms: result.durationMs,
    signature_sent: result.signatureSent,
    error: result.error,
    payload: result.payload,
  };
}

export const POST = authz({ scope: "write" })(
  time()(
    obs()(
      async (req, { params }) => {
        const config = loadConfig();
        const { serial } = await params;

        try {
          const { webhookTest } = composeServices(config);
          const result = await webhookTest.test(serial, req.signal);

          if (result === null) {
            return NextResponse.json({ error: { message: "Webhook config not found", type: "OAuthException", code: 400 } }, { status: 404 });
          }

          return NextResponse.json({ webhook_test: toWebhookTestJson(result) });
        } catch (err) {
          if (err instanceof ValidationError) {
            return NextResponse.json({ error: { message: err.message, type: "OAuthException", code: 400 } }, { status: 400 });
          }
          if (err instanceof RequestAbortedError) {
            throw err; // client is gone; do not map to a response
          }
          console.error(err);
          return NextResponse.json({ error: { message: "Internal server error", type: "OAuthException", code: 500 } }, { status: 500 });
        }
      },
    ),
  ),
);
