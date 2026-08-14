/**
 * Route Handler: POST /api/waba/:version/:phone_number_id/messages
 *
 * WABA-compatible send-text-message endpoint. Validates the API version path
 * param, authenticates, validates the WABA text payload, enqueues the send via
 * SendMessagePort, polls for the terminal result, and returns the official
 * WABA 200 envelope (with the real wamid) or a WABA-shaped error envelope.
 */

import { NextRequest, NextResponse } from "next/server";
import { composeServices } from "@/lib/api/compose";
import { loadConfig } from "@/lib/api/config";
import { authorizeApi } from "@/lib/api/server-auth";
import { parseApiVersion, SUPPORTED_API_VERSIONS } from "@/lib/api/domain/api-version";
import { parseOutboundMessage } from "@/lib/api/domain/outbound-message";
import type { OutboundMessage } from "@/lib/api/domain/outbound-message";
import {
  RequestAbortedError,
  SendTimeoutError,
  ValidationError,
} from "@/lib/api/domain/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ version: string; phoneNumberId: string }>;
}

/** WABA-shaped error envelope, consistent with the other v1 routes. */
function errorEnvelope(message: string, code: number, details?: string) {
  const error: Record<string, unknown> = { message, type: "OAuthException", code };
  if (details !== undefined) {
    error.error_data = { details };
  }
  return NextResponse.json({ error }, { status: code });
}

export async function POST(req: NextRequest, context: RouteContext) {
  const config = loadConfig();
  if (
    !(await authorizeApi(req, config.apiAuthToken, {
      requiredScope: "write",
      getPersistedKeys: () => composeServices(config).apiKeyAuth,
    }))
  ) {
    return errorEnvelope("Invalid OAuth access token", 401);
  }

  const { version, phoneNumberId } = await context.params;
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
    throw err;
  }
}
