/**
 * Route Handler: GET /api/v1/webhooks, POST /api/v1/webhooks
 */

import { NextResponse } from "next/server";
import { composeServices } from "@/lib/api/compose";
import { loadConfig } from "@/lib/api/config";
import { authz } from "@/lib/api/authz";
import { time } from "@/lib/api/time";
import { obs } from "@/lib/api/observability-capture";
import { ValidationError } from "@/lib/api/domain/errors";
import type { WebhookConfig } from "@/lib/api/domain/webhook-config";

export const runtime = "nodejs";

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
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

export const GET = authz({ scope: "read" })(
  time()(
    obs()(
      async () => {
        const config = loadConfig();
        const { webhookManagement } = composeServices(config);
        const configs = await webhookManagement.listConfigs();
        return NextResponse.json({ webhooks: configs.map(toWebhookConfigJson) });
      },
    ),
  ),
);

export const POST = authz({ scope: "write" })(
  time()(
    obs()(
      async (req) => {
        const config = loadConfig();

        let body: Record<string, unknown>;
        try {
          body = await req.json();
        } catch {
          return NextResponse.json({ error: { message: "Invalid request body", type: "OAuthException", code: 400 } }, { status: 400 });
        }

        try {
          const { webhookManagement } = composeServices(config);
          const cfg = await webhookManagement.createConfig({
            phoneNumberId: asString(body.phone_number_id) ?? "",
            webhookUrl: asString(body.webhook_url) ?? "",
            webhookSecret: asString(body.webhook_secret) ?? undefined,
          });
          return NextResponse.json(toWebhookConfigJson(cfg), { status: 201 });
        } catch (err) {
          if (err instanceof ValidationError) {
            return NextResponse.json({ error: { message: err.message, type: "OAuthException", code: 400 } }, { status: 400 });
          }
          throw err;
        }
      },
    ),
  ),
);
