/**
 * Hono HTTP adapter. Thin layer: routes, auth wiring, and WABA envelope
 * mapping only. It knows nothing about serials, polling, supabase, or
 * validation rules — those live in the service and domain layers.
 */

import { Hono } from "hono";
import type { Config } from "../../config.js";
import {
  RequestAbortedError,
  SendTimeoutError,
  ValidationError,
} from "../../domain/errors.js";
import { parseOutboundMessage } from "../../domain/outbound-message.js";
import type { WebhookConfig } from "../../domain/webhook-config.js";
import type { SendMessagePort } from "../../ports/send-message.js";
import type { WebhookConfigProvider } from "../../ports/webhook-config-provider.js";
import { authorizeBearer } from "./auth.js";
import {
  WABA_CODE_INTERNAL,
  WABA_CODE_INVALID_PARAM,
  WABA_CODE_INVALID_TOKEN,
  wabaError,
} from "./waba-error.js";

export interface AppDeps {
  sendMessage: SendMessagePort;
  webhookConfig: WebhookConfigProvider;
  config: Config;
}

export function createApp({ sendMessage, webhookConfig, config }: AppDeps): Hono {
  const app = new Hono();

  if (config.internalToken === "") {
    // INTERNAL_TOKEN unset: disable the worker-facing route and log so it is
    // discoverable in the runtime logs rather than silently 401ing.
    console.warn(
      "[waba-api] INTERNAL_TOKEN is not set; GET /internal/webhook-config is disabled and will return 401",
    );
  }

  app.get("/", (c) => c.json({ ok: true, service: "api" }));

  app.post("/:phone_number_id/messages", async (c) => {
    if (!authorizeBearer(c, config.apiAuthToken)) {
      return wabaError(c, 401, WABA_CODE_INVALID_TOKEN, "Invalid OAuth access token");
    }

    const phoneNumberId = c.req.param("phone_number_id");

    let body: Record<string, unknown>;
    try {
      body = await c.req.json<Record<string, unknown>>();
    } catch {
      return wabaError(c, 400, WABA_CODE_INVALID_PARAM, "Invalid request body");
    }

    let message;
    try {
      message = parseOutboundMessage(body);
    } catch (err) {
      if (err instanceof ValidationError) {
        return wabaError(c, 400, WABA_CODE_INVALID_PARAM, err.message);
      }
      throw err;
    }

    // Idempotency key: header wins over the body field.
    const headerKey = c.req.header("Idempotency-Key");
    const bodyKey =
      typeof body.idempotency_key === "string" ? body.idempotency_key : "";
    const idempotencyKey =
      headerKey !== undefined && headerKey !== "" ? headerKey : bodyKey;

    // The worker reads the WABA message from payload; keep the idempotency
    // bookkeeping out of it.
    const { idempotency_key: _strip, ...payload } = body;

    let result;
    try {
      result = await sendMessage.send({
        phoneNumberId,
        payload,
        idempotencyKey: idempotencyKey === "" ? undefined : idempotencyKey,
        signal: c.req.raw.signal,
      });
    } catch (err) {
      if (err instanceof RequestAbortedError) {
        throw err;
      }
      if (err instanceof SendTimeoutError) {
        return wabaError(c, 504, WABA_CODE_INTERNAL, "Send timed out");
      }
      return wabaError(c, 500, WABA_CODE_INTERNAL, "Internal server error");
    }

    if (result.status === "succeeded") {
      return c.json({
        messaging_product: "whatsapp",
        contacts: [{ input: message.to, wa_id: message.to }],
        messages: [{ id: result.wamid }],
      });
    }
    return wabaError(c, 500, WABA_CODE_INTERNAL, result.reason);
  });

  app.get("/internal/webhook-config", async (c) => {
    if (config.internalToken === "") {
      return wabaError(c, 401, WABA_CODE_INVALID_TOKEN, "Invalid OAuth access token");
    }
    if (!authorizeBearer(c, config.internalToken)) {
      return wabaError(c, 401, WABA_CODE_INVALID_TOKEN, "Invalid OAuth access token");
    }

    const phoneNumberId = c.req.query("phone_number_id");
    if (phoneNumberId === undefined || phoneNumberId === "") {
      return wabaError(c, 400, WABA_CODE_INVALID_PARAM, "phone_number_id is required");
    }

    let cfg: WebhookConfig | null;
    try {
      cfg = await webhookConfig.get(phoneNumberId);
    } catch {
      return wabaError(c, 500, WABA_CODE_INTERNAL, "Internal server error");
    }

    if (cfg === null) {
      return wabaError(c, 404, WABA_CODE_INVALID_PARAM, "Webhook config not found");
    }

    return c.json({
      webhook_url: cfg.webhook_url,
      webhook_secret: cfg.webhook_secret,
    });
  });

  return app;
}
