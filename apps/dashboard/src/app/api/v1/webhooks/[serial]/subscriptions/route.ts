/**
 * Route Handler: GET /api/v1/webhooks/[serial]/subscriptions, POST /api/v1/webhooks/[serial]/subscriptions
 */

import { NextResponse } from "next/server";
import { composeServices } from "@/lib/api/compose";
import { loadConfig } from "@/lib/api/config";
import { authz } from "@/lib/api/authz";
import { time } from "@/lib/api/time";
import { obs } from "@/lib/api/observability-capture";
import { ValidationError } from "@/lib/api/domain/errors";
import type { WebhookSubscription } from "@/lib/api/domain/webhook-config";

export const runtime = "nodejs";

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toSubscriptionJson(sub: WebhookSubscription) {
  return {
    id: sub.id,
    serial: sub.serial,
    webhook_config_id: sub.webhookConfigId,
    event_type: sub.eventType,
    created_at: sub.createdAt,
  };
}

export const GET = authz({ scope: "read" })(
  time()(
    obs()(
      async (req, { params }) => {
        const config = loadConfig();
        const { serial } = await params;
        const { webhookManagement } = composeServices(config);
        const subscriptions = await webhookManagement.listSubscriptions(serial);

        if (subscriptions === null) {
          return NextResponse.json({ error: { message: "Webhook config not found", type: "OAuthException", code: 400 } }, { status: 404 });
        }

        return NextResponse.json({ subscriptions: subscriptions.map(toSubscriptionJson) });
      },
    ),
  ),
);

export const POST = authz({ scope: "write" })(
  time()(
    obs()(
      async (req, { params }) => {
        const config = loadConfig();
        const { serial } = await params;
        let body: Record<string, unknown>;
        try {
          body = await req.json();
        } catch {
          return NextResponse.json({ error: { message: "Invalid request body", type: "OAuthException", code: 400 } }, { status: 400 });
        }

        try {
          const { webhookManagement } = composeServices(config);
          const subscription = await webhookManagement.addSubscription(
            serial,
            asString(body.event_type) ?? "",
          );

          if (subscription === null) {
            return NextResponse.json({ error: { message: "Webhook config not found", type: "OAuthException", code: 400 } }, { status: 404 });
          }

          return NextResponse.json(toSubscriptionJson(subscription), { status: 201 });
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
