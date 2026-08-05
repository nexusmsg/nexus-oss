/**
 * Hono HTTP adapter. Thin layer: routes, auth wiring, and WABA envelope
 * mapping only. It knows nothing about serials, polling, supabase, or
 * validation rules — those live in the service and domain layers.
 *
 * Route prefix conventions:
 *   `/api/v1/...`        our own API (sessions, ...)
 *   `/:phone_number_id`  WABA-compatible (no prefix)
 *   `/internal/v1/...`   internal (worker ↔ API)
 */

import { Hono } from "hono";
import type { Context } from "hono";
import type { Config } from "../../config.js";
import {
  RequestAbortedError,
  SendTimeoutError,
  ValidationError,
} from "../../domain/errors.js";
import { parseOutboundMessage } from "../../domain/outbound-message.js";
import type { Session } from "../../domain/session.js";
import type { WebhookConfig, WebhookSubscription } from "../../domain/webhook-config.js";
import type { SendMessagePort } from "../../ports/send-message.js";
import type { SessionServicePort } from "../../ports/session-service.js";
import type { WebhookConfigProvider } from "../../ports/webhook-config-provider.js";
import type { WebhookConfigManagementServicePort } from "../../service/webhook-config-management.js";
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
  webhookManagement: WebhookConfigManagementServicePort;
  sessionService: SessionServicePort;
  config: Config;
}

export function createApp({
  sendMessage,
  webhookConfig,
  webhookManagement,
  sessionService,
  config,
}: AppDeps): Hono {
  const app = new Hono();

  if (config.internalToken === "") {
    // INTERNAL_TOKEN unset: disable the worker-facing routes and log so it is
    // discoverable in the runtime logs rather than silently 401ing.
    console.warn(
      "[waba-api] INTERNAL_TOKEN is not set; /internal/v1 routes are disabled and will return 401",
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

  // ---------------------------------------------------------------------------
  // /api/v1 — our own session API
  // ---------------------------------------------------------------------------
  const apiV1 = new Hono();

  apiV1.use("*", async (c, next) => {
    if (!authorizeBearer(c, config.apiAuthToken)) {
      return wabaError(c, 401, WABA_CODE_INVALID_TOKEN, "Invalid OAuth access token");
    }
    return next();
  });

  apiV1.post("/sessions", async (c) => {
    const body = await readJsonBody(c);
    if (body === null) {
      return wabaError(c, 400, WABA_CODE_INVALID_PARAM, "Invalid request body");
    }

    try {
      const session = await sessionService.createSession({
        phoneNumberId: asString(body.phone_number_id) ?? "",
        number: asString(body.number) ?? "",
        displayPhone: asString(body.display_phone) ?? undefined,
        businessAccountId: asString(body.business_account_id) ?? undefined,
      });
      return c.json(toSessionJson(session), 201);
    } catch (err) {
      if (err instanceof ValidationError) {
        return wabaError(c, 400, WABA_CODE_INVALID_PARAM, err.message);
      }
      throw err;
    }
  });

  apiV1.get("/sessions", async (c) => {
    const sessions = await sessionService.listSessions();
    return c.json({ sessions: sessions.map(toSessionJson) });
  });

  apiV1.get("/sessions/:serial", async (c) => {
    const session = await sessionService.getSession(c.req.param("serial"));
    if (session === null) {
      return wabaError(c, 404, WABA_CODE_INVALID_PARAM, "Session not found");
    }
    return c.json(toSessionJson(session));
  });

  apiV1.post("/sessions/:serial/pairing", async (c) => {
    const result = await sessionService.startPairing(c.req.param("serial"));
    if (result === null) {
      return wabaError(c, 404, WABA_CODE_INVALID_PARAM, "Session not found");
    }
    return c.json({ job_serial: result.jobSerial }, 202);
  });

  apiV1.get("/sessions/:serial/pairing/qr", async (c) => {
    const result = await sessionService.getPairingQr(c.req.param("serial"));
    if (result === null) {
      return wabaError(c, 404, WABA_CODE_INVALID_PARAM, "Session not found");
    }
    return c.json({ status: result.status, qr_code: result.qrCode });
  });

  apiV1.post("/sessions/:serial/logout", async (c) => {
    const result = await sessionService.startLogout(c.req.param("serial"));
    if (result === null) {
      return wabaError(c, 404, WABA_CODE_INVALID_PARAM, "Session not found");
    }
    return c.json({ job_serial: result.jobSerial }, 202);
  });

  apiV1.get("/sessions/:serial/status", async (c) => {
    const result = await sessionService.getStatus(c.req.param("serial"));
    if (result === null) {
      return wabaError(c, 404, WABA_CODE_INVALID_PARAM, "Session not found");
    }
    return c.json(result);
  });

  // ---------------------------------------------------------------------------
  // /api/v1/webhooks — webhook config management
  // ---------------------------------------------------------------------------

  apiV1.post("/webhooks", async (c) => {
    const body = await readJsonBody(c);
    if (body === null) {
      return wabaError(c, 400, WABA_CODE_INVALID_PARAM, "Invalid request body");
    }

    try {
      const config = await webhookManagement.createConfig({
        phoneNumberId: asString(body.phone_number_id) ?? "",
        webhookUrl: asString(body.webhook_url) ?? "",
        webhookSecret: asString(body.webhook_secret) ?? undefined,
      });
      return c.json(toWebhookConfigJson(config), 201);
    } catch (err) {
      if (err instanceof ValidationError) {
        return wabaError(c, 400, WABA_CODE_INVALID_PARAM, err.message);
      }
      throw err;
    }
  });

  apiV1.get("/webhooks", async (c) => {
    const configs = await webhookManagement.listConfigs();
    return c.json({ webhooks: configs.map(toWebhookConfigJson) });
  });

  apiV1.get("/webhooks/:serial", async (c) => {
    const config = await webhookManagement.getConfig(c.req.param("serial"));
    if (config === null) {
      return wabaError(c, 404, WABA_CODE_INVALID_PARAM, "Webhook config not found");
    }
    return c.json(toWebhookConfigJson(config));
  });

  apiV1.patch("/webhooks/:serial", async (c) => {
    const body = await readJsonBody(c);
    if (body === null) {
      return wabaError(c, 400, WABA_CODE_INVALID_PARAM, "Invalid request body");
    }

    try {
      const config = await webhookManagement.updateConfig(c.req.param("serial"), {
        webhookUrl: asString(body.webhook_url) ?? undefined,
        webhookSecret: asString(body.webhook_secret) ?? undefined,
        enabled: asBoolean(body.enabled),
        maxRetries: asNumber(body.max_retries),
        retryDelayMs: asNumber(body.retry_delay_ms),
        timeoutMs: asNumber(body.timeout_ms),
      });
      if (config === null) {
        return wabaError(c, 404, WABA_CODE_INVALID_PARAM, "Webhook config not found");
      }
      return c.json(toWebhookConfigJson(config));
    } catch (err) {
      if (err instanceof ValidationError) {
        return wabaError(c, 400, WABA_CODE_INVALID_PARAM, err.message);
      }
      throw err;
    }
  });

  apiV1.delete("/webhooks/:serial", async (c) => {
    const config = await webhookManagement.deleteConfig(c.req.param("serial"));
    if (config === null) {
      return wabaError(c, 404, WABA_CODE_INVALID_PARAM, "Webhook config not found");
    }
    return c.json({ ok: true });
  });

  apiV1.get("/webhooks/:serial/subscriptions", async (c) => {
    const subscriptions = await webhookManagement.listSubscriptions(c.req.param("serial"));
    if (subscriptions === null) {
      return wabaError(c, 404, WABA_CODE_INVALID_PARAM, "Webhook config not found");
    }
    return c.json({ subscriptions: subscriptions.map(toSubscriptionJson) });
  });

  apiV1.post("/webhooks/:serial/subscriptions", async (c) => {
    const body = await readJsonBody(c);
    if (body === null) {
      return wabaError(c, 400, WABA_CODE_INVALID_PARAM, "Invalid request body");
    }

    try {
      const subscription = await webhookManagement.addSubscription(
        c.req.param("serial"),
        asString(body.event_type) ?? "",
      );
      if (subscription === null) {
        return wabaError(c, 404, WABA_CODE_INVALID_PARAM, "Webhook config not found");
      }
      return c.json(toSubscriptionJson(subscription), 201);
    } catch (err) {
      if (err instanceof ValidationError) {
        return wabaError(c, 400, WABA_CODE_INVALID_PARAM, err.message);
      }
      throw err;
    }
  });

  apiV1.delete("/webhooks/:serial/subscriptions/:eventType", async (c) => {
    const config = await webhookManagement.removeSubscription(
      c.req.param("serial"),
      c.req.param("eventType"),
    );
    if (config === null) {
      return wabaError(c, 404, WABA_CODE_INVALID_PARAM, "Webhook config not found");
    }
    return c.json({ ok: true });
  });

  app.route("/api/v1", apiV1);

  // ---------------------------------------------------------------------------
  // /internal/v1 — worker ↔ API
  // ---------------------------------------------------------------------------
  const internalV1 = new Hono();

  internalV1.use("*", async (c, next) => {
    if (config.internalToken === "" || !authorizeBearer(c, config.internalToken)) {
      return wabaError(c, 401, WABA_CODE_INVALID_TOKEN, "Invalid OAuth access token");
    }
    return next();
  });

  internalV1.get("/webhook-config", (c) => getWebhookConfig(c, webhookConfig));

  internalV1.post("/heartbeat", async (c) => {
    const body = await readJsonBody(c);
    if (body === null) {
      return wabaError(c, 400, WABA_CODE_INVALID_PARAM, "Invalid request body");
    }

    try {
      await sessionService.heartbeat(asString(body.phone_number_id) ?? "");
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof ValidationError) {
        return wabaError(c, 400, WABA_CODE_INVALID_PARAM, err.message);
      }
      throw err;
    }
  });

  app.route("/internal/v1", internalV1);

  // Backward-compatible alias for the moved webhook-config route.
  app.get("/internal/webhook-config", async (c) => {
    if (config.internalToken === "" || !authorizeBearer(c, config.internalToken)) {
      return wabaError(c, 401, WABA_CODE_INVALID_TOKEN, "Invalid OAuth access token");
    }
    return getWebhookConfig(c, webhookConfig);
  });

  return app;
}

/**
 * Handler body shared by /internal/v1/webhook-config and its legacy alias.
 * Returns a WABA envelope on error; the JSON payload on success.
 */
async function getWebhookConfig(c: Context, webhookConfig: WebhookConfigProvider): Promise<Response> {
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
    webhook_url: cfg.webhookUrl,
    webhook_secret: cfg.webhookSecret,
  });
}

/** Parse a JSON object body; null when unparseable or not a plain object. */
async function readJsonBody(c: Context): Promise<Record<string, unknown> | null> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return null;
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  return body as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toWebhookConfigJson(cfg: WebhookConfig): Record<string, unknown> {
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

function toSubscriptionJson(sub: WebhookSubscription): Record<string, unknown> {
  return {
    id: sub.id,
    serial: sub.serial,
    webhook_config_id: sub.webhookConfigId,
    event_type: sub.eventType,
    created_at: sub.createdAt,
  };
}

function toSessionJson(session: Session): Record<string, unknown> {
  return {
    id: session.serial,
    phone_number_id: session.phoneNumberId,
    number: session.number,
    display_phone: session.displayPhone,
    business_account_id: session.businessAccountId,
    status: session.status,
    whatsapp_id: session.whatsappId,
    connected_at: session.connectedAt,
    last_seen_at: session.lastSeenAt,
    logged_out_at: session.loggedOutAt,
    created_at: session.createdAt,
  };
}
