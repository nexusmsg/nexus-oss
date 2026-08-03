/**
 * Hono app factory. `createApp` takes an injected `JobTransport` so tests can
 * exercise the full HTTP surface with a fake transport (no network).
 */

import { timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Config } from "./config.js";
import type { JobTransport, PollResult, WebhookConfigRow } from "./transport.js";

export interface AppDeps {
  transport: JobTransport;
  config: Config;
}

const WABA_ERROR_TYPE = "OAuthException";

const BEARER_PREFIX = "Bearer ";

const SUPPORTED_CATEGORIES = new Set(["utility", "authentication", "service"]);

/** Terminal statuses produced by the worker queue consumer. */
const TERMINAL_STATUSES = new Set(["succeeded", "failed"]);

/**
 * WABA-shaped error envelope: `{ error: { message, type, code } }`.
 */
function wabaError(
  c: Context,
  status: ContentfulStatusCode,
  code: number,
  message: string,
): Response {
  return c.json(
    {
      error: {
        message,
        type: WABA_ERROR_TYPE,
        code,
      },
    },
    status,
  );
}

/** Constant-time string comparison; unequal lengths never compare equal. */
function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Returns true when the request is authorized. An empty `expected` token means
 * auth is disabled and every request is accepted.
 */
function authorizeBearer(c: Context, expected: string): boolean {
  if (expected === "") {
    return true;
  }
  const header = c.req.header("Authorization");
  if (header === undefined || !header.startsWith(BEARER_PREFIX)) {
    return false;
  }
  return safeEqual(header.slice(BEARER_PREFIX.length), expected);
}

/**
 * Mirrors the WABA field validation in
 * `services/worker/internal/service/outbound.go` (validateOutboundMessage),
 * including the order of checks and the exact error messages.
 */
function validateSendMessage(body: Record<string, unknown>): string | null {
  if (body.messaging_product !== "whatsapp") {
    return "messaging_product must be whatsapp";
  }
  const messageType = typeof body.type === "string" ? body.type : "";
  if (messageType !== "text") {
    return `message type "${messageType}" is not supported`;
  }
  const text = body.text;
  const textBody =
    text !== null && typeof text === "object"
      ? (text as Record<string, unknown>).body
      : undefined;
  if (typeof textBody !== "string" || textBody.trim() === "") {
    return "text.body is required";
  }
  if (typeof body.to !== "string" || body.to === "") {
    return "to is required";
  }
  const category = body.category;
  if (
    category !== undefined &&
    category !== "" &&
    (typeof category !== "string" || !SUPPORTED_CATEGORIES.has(category))
  ) {
    return "category must be utility, authentication, or service";
  }
  return null;
}

/** Extract `wa_message_id` from a worker result row (jsonb). */
function extractWaMessageId(result: unknown): string | null {
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    return null;
  }
  const waMessageId = (result as Record<string, unknown>).wa_message_id;
  return typeof waMessageId === "string" && waMessageId !== "" ? waMessageId : null;
}

class SendTimeoutError extends Error {
  constructor() {
    super("send timed out");
    this.name = "SendTimeoutError";
  }
}

class RequestAbortedError extends Error {
  constructor() {
    super("request aborted");
    this.name = "AbortError";
  }
}

/** Timer-based sleep that short-circuits on request abort. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal !== undefined && signal.aborted) {
      reject(new RequestAbortedError());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new RequestAbortedError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Poll the job row until it reaches a terminal status or the deadline elapses.
 * `Date.now()` is used for the deadline so the wall clock governs the timeout.
 */
async function waitForResult(
  transport: JobTransport,
  serial: string,
  sendTimeoutMs: number,
  resultPollMs: number,
  signal?: AbortSignal,
): Promise<PollResult> {
  const deadline = Date.now() + sendTimeoutMs;
  for (;;) {
    if (signal !== undefined && signal.aborted) {
      throw new RequestAbortedError();
    }
    const row = await transport.poll(serial);
    if (row !== null && TERMINAL_STATUSES.has(row.status)) {
      return row;
    }
    if (Date.now() >= deadline) {
      throw new SendTimeoutError();
    }
    await sleep(resultPollMs, signal);
  }
}

export function createApp({ transport, config }: AppDeps): Hono {
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
      return wabaError(c, 401, 190, "Invalid OAuth access token");
    }

    const phoneNumberId = c.req.param("phone_number_id");

    let body: Record<string, unknown>;
    try {
      body = await c.req.json<Record<string, unknown>>();
    } catch {
      return wabaError(c, 400, 100, "Invalid request body");
    }

    const validationError = validateSendMessage(body);
    if (validationError !== null) {
      return wabaError(c, 400, 100, validationError);
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

    let serial: string;
    try {
      serial = await transport.enqueue({
        phoneNumberId,
        payload,
        idempotencyKey: idempotencyKey === "" ? undefined : idempotencyKey,
      });
    } catch {
      return wabaError(c, 500, 131000, "Internal server error");
    }

    let outcome: PollResult;
    try {
      outcome = await waitForResult(
        transport,
        serial,
        config.sendTimeoutMs,
        config.resultPollMs,
        c.req.raw.signal,
      );
    } catch (err) {
      if (err instanceof RequestAbortedError) {
        throw err;
      }
      if (err instanceof SendTimeoutError) {
        return wabaError(c, 504, 131000, "Send timed out");
      }
      return wabaError(c, 500, 131000, "Internal server error");
    }

    if (outcome.status === "succeeded") {
      const waMessageId = extractWaMessageId(outcome.result);
      if (waMessageId !== null) {
        const to = typeof body.to === "string" ? body.to : "";
        return c.json({
          messaging_product: "whatsapp",
          contacts: [{ input: to, wa_id: to }],
          messages: [{ id: waMessageId }],
        });
      }
      return wabaError(c, 500, 131000, "Internal server error");
    }

    // Failed: surface the worker's last error in the WABA envelope.
    return wabaError(
      c,
      500,
      131000,
      outcome.lastError !== null && outcome.lastError !== ""
        ? outcome.lastError
        : "Unable to send message",
    );
  });

  app.get("/internal/webhook-config", async (c) => {
    if (config.internalToken === "") {
      return wabaError(c, 401, 190, "Invalid OAuth access token");
    }
    if (!authorizeBearer(c, config.internalToken)) {
      return wabaError(c, 401, 190, "Invalid OAuth access token");
    }

    const phoneNumberId = c.req.query("phone_number_id");
    if (phoneNumberId === undefined || phoneNumberId === "") {
      return wabaError(c, 400, 100, "phone_number_id is required");
    }

    let webhookConfig: WebhookConfigRow | null;
    try {
      webhookConfig = await transport.getWebhookConfig(phoneNumberId);
    } catch {
      return wabaError(c, 500, 131000, "Internal server error");
    }

    if (webhookConfig === null) {
      return wabaError(c, 404, 100, "Webhook config not found");
    }

    return c.json({
      webhook_url: webhookConfig.webhook_url,
      webhook_secret: webhookConfig.webhook_secret,
    });
  });

  return app;
}
