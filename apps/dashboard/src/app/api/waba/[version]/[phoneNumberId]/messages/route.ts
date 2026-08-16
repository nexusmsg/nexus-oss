/**
 * Route Handler: POST /api/waba/:version/:phone_number_id/messages
 *
 * WABA-compatible send-text-message endpoint. Validates the API version path
 * param, authenticates, validates the WABA text payload, enqueues the send via
 * SendMessagePort, polls for the terminal result, and returns the official
 * WABA 200 envelope (with the real wamid) or a WABA-shaped error envelope.
 */

import { NextResponse } from "next/server";
import { composeServices } from "@/lib/api/compose";
import { loadConfig } from "@/lib/api/config";
import { parseApiVersion, SUPPORTED_API_VERSIONS } from "@/lib/api/domain/api-version";
import { parseOutboundMessage } from "@/lib/api/domain/outbound-message";
import type { OutboundMessage } from "@/lib/api/domain/outbound-message";
import {
  RequestAbortedError,
  SendTimeoutError,
  ValidationError,
} from "@/lib/api/domain/errors";
import { authz } from "@/lib/api/authz";
import { time } from "@/lib/api/time";
import { obs } from "@/lib/api/observability-capture";

export const runtime = "nodejs";

/** WABA-shaped error envelope, consistent with the other v1 routes. */
function errorEnvelope(message: string, code: number, details?: string) {
  const error: Record<string, unknown> = { message, type: "OAuthException", code };
  if (details !== undefined) {
    error.error_data = { details };
  }
  return NextResponse.json({ error }, { status: code });
}

export const POST = authz({ scope: "write" })(
  time()(
    obs({ resolvePath: () => "/api/waba/:version/:phone_number_id/messages" })(
      async (req, { params, activity }) => {
        const config = loadConfig();
        const { version, phoneNumberId } = await params;
        if (parseApiVersion(version) === null) {
          return errorEnvelope(
            `Unsupported API version '${version}'. Supported versions: ${SUPPORTED_API_VERSIONS.join(", ")}`,
            400,
          );
        }

        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return errorEnvelope("Invalid request body", 400);
        }

        let message: OutboundMessage;
        try {
          message = parseOutboundMessage(body);
        } catch (err) {
          if (err instanceof ValidationError) {
            return errorEnvelope(err.message, 400);
          }
          throw err;
        }

        try {
          const result = await composeServices(config).sendMessage.send({
            phoneNumberId,
            payload: message,
            signal: req.signal,
          });

          if (result.status === "failed") {
            return errorEnvelope("Message send failed", 500, result.reason);
          }

          // The send enqueued a job; correlate this activity row to it (R1/§5).
          if (result.jobSerial !== undefined) {
            activity.setJobSerial(result.jobSerial);
          }

          return NextResponse.json({
            messaging_product: "whatsapp",
            contacts: [{ input: message.to, wa_id: message.to.replace(/^\+/, "") }],
            messages: [{ id: result.wamid }],
          });
        } catch (err) {
          if (err instanceof SendTimeoutError) {
            return errorEnvelope("Message send timed out", 504);
          }
          if (err instanceof RequestAbortedError) {
            return errorEnvelope("Request aborted", 400);
          }
          if (err instanceof ValidationError) {
            return errorEnvelope(err.message, 400);
          }
          throw err;
        }
      },
    ),
  ),
);