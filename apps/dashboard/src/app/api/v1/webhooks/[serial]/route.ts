/**
 * Route Handler: GET /api/v1/webhooks/[serial], PATCH /api/v1/webhooks/[serial], DELETE /api/v1/webhooks/[serial]
 */

import { NextRequest, NextResponse } from "next/server";
import { composeServices } from "@/lib/api/compose";
import { loadConfig } from "@/lib/api/config";
import { authorizeBearer } from "@/lib/api/server-auth";
import { ValidationError } from "@/lib/api/domain/errors";
import type { WebhookConfig } from "@/lib/api/domain/webhook-config";

export const runtime = "nodejs";

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toWebhookConfigJson(cfg: WebhookConfig) {
  return {
    id: cfg.id,
    serial: cfg.serial,
    phone_number_id: cfg.phoneNumberId,
    webhook_url: cfg.webhookUrl,
    webhook_secret: cfg.webhookSecret,
    enabled: cfg.enabled,
    max_retries: cfg.maxRetries,
    retry_delay_ms: cfg.retryDelayMs,
    timeout_ms: cfg.timeoutMs,
    created_at: cfg.createdAt,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ serial: string }> }
) {
  const config = loadConfig();
  if (!authorizeBearer(req, config.apiAuthToken)) {
    return NextResponse.json({ error: { message: "Invalid OAuth access token", type: "OAuthException", code: 401 } }, { status: 401 });
  }

  const { serial } = await params;
  const { webhookManagement } = composeServices(config);
  const cfg = await webhookManagement.getConfig(serial);

  if (cfg === null) {
    return NextResponse.json({ error: { message: "Webhook config not found", type: "OAuthException", code: 400 } }, { status: 404 });
  }

  return NextResponse.json(toWebhookConfigJson(cfg));
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ serial: string }> }
) {
  const config = loadConfig();
  if (!authorizeBearer(req, config.apiAuthToken)) {
    return NextResponse.json({ error: { message: "Invalid OAuth access token", type: "OAuthException", code: 401 } }, { status: 401 });
  }

  const { serial } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid request body", type: "OAuthException", code: 400 } }, { status: 400 });
  }

  try {
    const { webhookManagement } = composeServices(config);
    const cfg = await webhookManagement.updateConfig(serial, {
      webhookUrl: asString(body.webhook_url) ?? undefined,
      webhookSecret: asString(body.webhook_secret) ?? undefined,
      enabled: asBoolean(body.enabled),
      maxRetries: asNumber(body.max_retries),
      retryDelayMs: asNumber(body.retry_delay_ms),
      timeoutMs: asNumber(body.timeout_ms),
    });

    if (cfg === null) {
      return NextResponse.json({ error: { message: "Webhook config not found", type: "OAuthException", code: 400 } }, { status: 404 });
    }

    return NextResponse.json(toWebhookConfigJson(cfg));
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: { message: err.message, type: "OAuthException", code: 400 } }, { status: 400 });
    }
    throw err;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ serial: string }> }
) {
  const config = loadConfig();
  if (!authorizeBearer(req, config.apiAuthToken)) {
    return NextResponse.json({ error: { message: "Invalid OAuth access token", type: "OAuthException", code: 401 } }, { status: 401 });
  }

  const { serial } = await params;
  const { webhookManagement } = composeServices(config);
  const cfg = await webhookManagement.deleteConfig(serial);

  if (cfg === null) {
    return NextResponse.json({ error: { message: "Webhook config not found", type: "OAuthException", code: 400 } }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
