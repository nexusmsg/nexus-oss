import { describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { Config } from "../../config.js";
import { SendTimeoutError, ValidationError } from "../../domain/errors.js";
import type { CreateSessionInput, Session } from "../../domain/session.js";
import { SUPPORTED_EVENT_TYPES, type WebhookConfig, type WebhookSubscription } from "../../domain/webhook-config.js";
import type { SendMessageInput, SendMessagePort, SendMessageResult } from "../../ports/send-message.js";
import type { SessionServicePort } from "../../ports/session-service.js";
import type { WebhookConfigProvider } from "../../ports/webhook-config-provider.js";
import type { CreateWebhookConfigInput, UpdateWebhookConfigInput } from "../../ports/webhook-config-management.js";
import type { WebhookConfigManagementServicePort } from "../../service/webhook-config-management.js";
import { createApp } from "./app.js";

/**
 * Fake input ports so the HTTP mapping is tested in isolation: no service
 * layer, no polling, no network.
 */
class FakeSendMessage implements SendMessagePort {
  calls: SendMessageInput[] = [];

  constructor(
    private readonly behavior: (
      input: SendMessageInput,
    ) => Promise<SendMessageResult> = async () => ({
      status: "succeeded",
      wamid: "wamid.test.123",
    }),
  ) {}

  async send(input: SendMessageInput): Promise<SendMessageResult> {
    this.calls.push(input);
    return this.behavior(input);
  }
}

class FakeWebhookConfig implements WebhookConfigProvider {
  constructor(private readonly value: WebhookConfig | null = null) {}

  async get(_phoneNumberId: string): Promise<WebhookConfig | null> {
    return this.value;
  }
}

const SAMPLE_CONFIG: WebhookConfig = {
  id: 1,
  serial: "cfg-serial-1",
  phoneNumberId: "12345",
  webhookUrl: "https://hooks.example.com/wa",
  webhookSecret: "s3cret",
  enabled: true,
  maxRetries: 3,
  retryDelayMs: 1000,
  timeoutMs: 10000,
  createdAt: "2026-01-01T00:00:00Z",
};

function sampleSubscription(eventType: string): WebhookSubscription {
  return {
    id: 10,
    serial: `sub-serial-${eventType}`,
    webhookConfigId: 1,
    eventType,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

class FakeWebhookConfigManagement implements WebhookConfigManagementServicePort {
  configs = new Map<string, WebhookConfig>();
  subscriptions = new Map<number, WebhookSubscription[]>();
  private nextId = 100;

  constructor(configs: WebhookConfig[] = []) {
    for (const cfg of configs) {
      this.configs.set(cfg.serial, cfg);
      this.subscriptions.set(cfg.id, [sampleSubscription("messages")]);
    }
  }

  async createConfig(input: CreateWebhookConfigInput): Promise<WebhookConfig> {
    if (input.phoneNumberId === undefined || input.phoneNumberId.trim() === "") {
      throw new ValidationError("phone_number_id is required");
    }
    if (!isValidWebhookUrl(input.webhookUrl)) {
      throw new ValidationError("webhook_url must be a valid http(s) URL");
    }
    const existing = [...this.configs.values()].find(
      (c) => c.phoneNumberId === input.phoneNumberId,
    );
    if (existing !== undefined) throw new Error("already exists");
    const cfg: WebhookConfig = {
      id: this.nextId++,
      serial: `cfg-serial-${this.nextId}`,
      phoneNumberId: input.phoneNumberId,
      webhookUrl: input.webhookUrl,
      webhookSecret: input.webhookSecret ?? "generated-secret",
      enabled: true,
      maxRetries: 3,
      retryDelayMs: 1000,
      timeoutMs: 10000,
      createdAt: "2026-01-01T00:00:00Z",
    };
    this.configs.set(cfg.serial, cfg);
    this.subscriptions.set(cfg.id, [sampleSubscription("messages")]);
    return cfg;
  }

  async getConfig(serial: string): Promise<WebhookConfig | null> {
    return this.configs.get(serial) ?? null;
  }

  async listConfigs(): Promise<WebhookConfig[]> {
    return [...this.configs.values()];
  }

  async updateConfig(
    serial: string,
    input: UpdateWebhookConfigInput,
  ): Promise<WebhookConfig | null> {
    const cfg = this.configs.get(serial);
    if (cfg === undefined) return null;
    if (input.webhookUrl !== undefined && !isValidWebhookUrl(input.webhookUrl)) {
      throw new ValidationError("webhook_url must be a valid http(s) URL");
    }
    const updated: WebhookConfig = {
      ...cfg,
      webhookUrl: input.webhookUrl ?? cfg.webhookUrl,
      webhookSecret: input.webhookSecret ?? cfg.webhookSecret,
      enabled: input.enabled ?? cfg.enabled,
      maxRetries: input.maxRetries ?? cfg.maxRetries,
      retryDelayMs: input.retryDelayMs ?? cfg.retryDelayMs,
      timeoutMs: input.timeoutMs ?? cfg.timeoutMs,
    };
    this.configs.set(serial, updated);
    return updated;
  }

  async deleteConfig(serial: string): Promise<WebhookConfig | null> {
    const cfg = this.configs.get(serial);
    if (cfg === undefined) return null;
    this.configs.delete(serial);
    return cfg;
  }

  async listSubscriptions(serial: string): Promise<WebhookSubscription[] | null> {
    const cfg = this.configs.get(serial);
    if (cfg === undefined) return null;
    return this.subscriptions.get(cfg.id) ?? [];
  }

  async addSubscription(
    serial: string,
    eventType: string,
  ): Promise<WebhookSubscription | null> {
    const cfg = this.configs.get(serial);
    if (cfg === undefined) return null;
    if (!SUPPORTED_EVENT_TYPES.includes(eventType as (typeof SUPPORTED_EVENT_TYPES)[number])) {
      throw new ValidationError(
        `event_type must be one of: ${SUPPORTED_EVENT_TYPES.join(", ")}`,
      );
    }
    const subs = this.subscriptions.get(cfg.id) ?? [];
    const existing = subs.find((s) => s.eventType === eventType);
    if (existing !== undefined) return existing;
    const sub = sampleSubscription(eventType);
    this.subscriptions.set(cfg.id, [...subs, sub]);
    return sub;
  }

  async removeSubscription(serial: string, eventType: string): Promise<WebhookConfig | null> {
    const cfg = this.configs.get(serial);
    if (cfg === undefined) return null;
    this.subscriptions.set(
      cfg.id,
      (this.subscriptions.get(cfg.id) ?? []).filter((s) => s.eventType !== eventType),
    );
    return cfg;
  }
}

function isValidWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const SAMPLE_SESSION: Session = {
  id: 1,
  serial: "serial-1",
  phoneNumberId: "12345",
  number: "62812345678",
  displayPhone: "62812345678",
  businessAccountId: "",
  status: "connected",
  whatsappId: null,
  connectedAt: null,
  lastSeenAt: null,
  loggedOutAt: null,
  createdAt: "2026-01-01T00:00:00Z",
};

class FakeSessionService implements SessionServicePort {
  async createSession(input: CreateSessionInput): Promise<Session> {
    return { ...SAMPLE_SESSION, businessAccountId: input.businessAccountId ?? "" };
  }
  async getSession(_serial: string): Promise<Session | null> {
    return SAMPLE_SESSION;
  }
  async listSessions(): Promise<Session[]> {
    return [SAMPLE_SESSION];
  }
  async startPairing(_serial: string): Promise<{ jobSerial: string } | null> {
    return { jobSerial: "job-1" };
  }
  async getPairingQr(_serial: string): Promise<{ status: string; qrCode: string | null } | null> {
    return { status: "ready", qrCode: "qr-data" };
  }
  async startLogout(_serial: string): Promise<{ jobSerial: string } | null> {
    return { jobSerial: "job-2" };
  }
  async getStatus(_serial: string): Promise<{ status: string } | null> {
    return { status: "connected" };
  }
  async heartbeat(_phoneNumberId: string): Promise<void> {}
}

function makeApp(
  sendMessage: SendMessagePort = new FakeSendMessage(),
  webhookConfig: WebhookConfigProvider = new FakeWebhookConfig(),
  overrides: Partial<Config> = {},
  sessionService: SessionServicePort = new FakeSessionService(),
  webhookManagement: WebhookConfigManagementServicePort = new FakeWebhookConfigManagement(),
): Hono {
  const config: Config = {
    port: 3000,
    supabaseUrl: "https://example.supabase.co",
    supabaseServiceRoleKey: "test-service-role-key",
    apiAuthToken: "test-api-token",
    internalToken: "test-internal-token",
    sendTimeoutMs: 1000,
    resultPollMs: 5,
    ...overrides,
  };
  return createApp({ sendMessage, webhookConfig, webhookManagement, sessionService, config });
}

const VALID_MESSAGE = {
  messaging_product: "whatsapp",
  to: "62812345678",
  type: "text",
  text: { body: "hello world" },
};

async function sendRequest(
  app: Hono,
  overrides: {
    path?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<Response> {
  const { path = "/12345/messages", body = VALID_MESSAGE, headers = {} } = overrides;
  return app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-api-token",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("GET /", () => {
  it("returns ok and service name", async () => {
    const res = await makeApp().request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "api" });
  });
});

describe("POST /:phone_number_id/messages — auth", () => {
  it("returns 401 WABA envelope without a bearer token when auth is configured", async () => {
    const res = await sendRequest(makeApp(), { headers: { authorization: "" } });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { message: "Invalid OAuth access token", type: "OAuthException", code: 190 },
    });
  });

  it("returns 401 with a wrong bearer token", async () => {
    const res = await sendRequest(makeApp(), {
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
  });

  it("skips auth when API_AUTH_TOKEN is empty", async () => {
    const res = await sendRequest(makeApp(new FakeSendMessage(), undefined, { apiAuthToken: "" }), {
      headers: { authorization: "" },
    });
    expect(res.status).toBe(200);
  });
});

describe("POST /:phone_number_id/messages — validation", () => {
  it.each([
    [
      { ...VALID_MESSAGE, messaging_product: "sms" },
      "messaging_product must be whatsapp",
    ],
    [
      { ...VALID_MESSAGE, type: "image" },
      'message type "image" is not supported',
    ],
    [
      { ...VALID_MESSAGE, type: undefined },
      'message type "" is not supported',
    ],
    [
      { ...VALID_MESSAGE, text: undefined },
      "text.body is required",
    ],
    [
      { ...VALID_MESSAGE, text: { body: "   " } },
      "text.body is required",
    ],
    [
      { ...VALID_MESSAGE, to: undefined },
      "to is required",
    ],
    [
      { ...VALID_MESSAGE, category: "marketing" },
      "category must be utility, authentication, or service",
    ],
  ])("rejects invalid body %# with message %s", async (body, message) => {
    const res = await sendRequest(makeApp(), { body });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { message, type: "OAuthException", code: 100 },
    });
  });

  it("returns 400 on unparseable JSON", async () => {
    const res = await makeApp().request("/12345/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-api-token",
      },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe(100);
  });

  it("returns 400 on a non-object JSON body", async () => {
    const res = await sendRequest(makeApp(), { body: null });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { message: "Invalid request body", type: "OAuthException", code: 100 },
    });
  });

  it.each([["utility"], ["authentication"], ["service"]])(
    "accepts category %s",
    async (category) => {
      const res = await sendRequest(makeApp(), { body: { ...VALID_MESSAGE, category } });
      expect(res.status).toBe(200);
    },
  );
});

describe("POST /:phone_number_id/messages — send mapping", () => {
  it("returns the success envelope with the worker wamid", async () => {
    const sendMessage = new FakeSendMessage();
    const res = await sendRequest(makeApp(sendMessage), { path: "/12345/messages" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      messaging_product: "whatsapp",
      contacts: [{ input: "62812345678", wa_id: "62812345678" }],
      messages: [{ id: "wamid.test.123" }],
    });
    expect(sendMessage.calls).toHaveLength(1);
    expect(sendMessage.calls[0]).toMatchObject({
      phoneNumberId: "12345",
      payload: VALID_MESSAGE,
      idempotencyKey: undefined,
    });
    expect(sendMessage.calls[0].signal).toBeInstanceOf(AbortSignal);
  });

  it("returns 500 WABA envelope with the failed reason", async () => {
    const sendMessage = new FakeSendMessage(async () => ({
      status: "failed",
      reason: "recipient not on WhatsApp",
    }));
    const res = await sendRequest(makeApp(sendMessage));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: {
        message: "recipient not on WhatsApp",
        type: "OAuthException",
        code: 131000,
      },
    });
  });

  it("maps a failed 'Internal server error' reason to the 500 envelope", async () => {
    const sendMessage = new FakeSendMessage(async () => ({
      status: "failed",
      reason: "Internal server error",
    }));
    const res = await sendRequest(makeApp(sendMessage));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { message: "Internal server error", type: "OAuthException", code: 131000 },
    });
  });

  it("returns 504 WABA envelope when the service reports a timeout", async () => {
    const sendMessage = new FakeSendMessage(() => Promise.reject(new SendTimeoutError()));
    const res = await sendRequest(makeApp(sendMessage));

    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({
      error: { message: "Send timed out", type: "OAuthException", code: 131000 },
    });
  });

  it("returns 500 WABA envelope on unexpected send errors", async () => {
    const sendMessage = new FakeSendMessage(() => Promise.reject(new Error("boom")));
    const res = await sendRequest(makeApp(sendMessage));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { message: "Internal server error", type: "OAuthException", code: 131000 },
    });
  });
});

describe("POST /:phone_number_id/messages — idempotency", () => {
  it("passes the Idempotency-Key header to the send port", async () => {
    const sendMessage = new FakeSendMessage();
    const res = await sendRequest(makeApp(sendMessage), {
      headers: { "idempotency-key": "key-from-header" },
    });
    expect(res.status).toBe(200);
    expect(sendMessage.calls[0].idempotencyKey).toBe("key-from-header");
  });

  it("falls back to the body idempotency_key when no header is sent", async () => {
    const sendMessage = new FakeSendMessage();
    const res = await sendRequest(makeApp(sendMessage), {
      body: { ...VALID_MESSAGE, idempotency_key: "key-from-body" },
    });
    expect(res.status).toBe(200);
    expect(sendMessage.calls[0].idempotencyKey).toBe("key-from-body");
    // The idempotency key is kept out of the stored payload.
    expect(sendMessage.calls[0].payload).toEqual(VALID_MESSAGE);
  });

  it("lets the header win over the body idempotency_key", async () => {
    const sendMessage = new FakeSendMessage();
    const res = await sendRequest(makeApp(sendMessage), {
      headers: { "idempotency-key": "header-wins" },
      body: { ...VALID_MESSAGE, idempotency_key: "body-loses" },
    });
    expect(res.status).toBe(200);
    expect(sendMessage.calls[0].idempotencyKey).toBe("header-wins");
  });
});

describe("GET /internal/webhook-config", () => {
  const baseHeaders = { authorization: "Bearer test-internal-token" };

  it("returns 401 without the internal token", async () => {
    const res = await makeApp().request("/internal/webhook-config?phone_number_id=123");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { message: "Invalid OAuth access token", type: "OAuthException", code: 190 },
    });
  });

  it("returns 401 with a wrong internal token", async () => {
    const res = await makeApp().request("/internal/webhook-config?phone_number_id=123", {
      headers: { authorization: "Bearer nope" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when INTERNAL_TOKEN is unset (route disabled)", async () => {
    const res = await makeApp(new FakeSendMessage(), undefined, { internalToken: "" }).request(
      "/internal/webhook-config?phone_number_id=123",
      { headers: baseHeaders },
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when phone_number_id is missing", async () => {
    const res = await makeApp().request("/internal/webhook-config", { headers: baseHeaders });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { message: "phone_number_id is required", type: "OAuthException", code: 100 },
    });
  });

  it("returns webhook_url and webhook_secret", async () => {
    const webhookConfig = new FakeWebhookConfig(SAMPLE_CONFIG);
    const res = await makeApp(new FakeSendMessage(), webhookConfig).request(
      "/internal/webhook-config?phone_number_id=123",
      { headers: baseHeaders },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      webhook_url: "https://hooks.example.com/wa",
      webhook_secret: "s3cret",
    });
  });

  it("includes webhook_secret as null when it is unset", async () => {
    const webhookConfig = new FakeWebhookConfig({ ...SAMPLE_CONFIG, webhookSecret: null });
    const res = await makeApp(new FakeSendMessage(), webhookConfig).request(
      "/internal/webhook-config?phone_number_id=123",
      { headers: baseHeaders },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      webhook_url: "https://hooks.example.com/wa",
      webhook_secret: null,
    });
  });

  it("returns 404 when no config exists for the phone number", async () => {
    const webhookConfig = new FakeWebhookConfig(null);
    const res = await makeApp(new FakeSendMessage(), webhookConfig).request(
      "/internal/webhook-config?phone_number_id=unknown",
      { headers: baseHeaders },
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { message: "Webhook config not found", type: "OAuthException", code: 100 },
    });
  });
});

const AUTH_HEADERS = { authorization: "Bearer test-api-token" };

function apiRequest(
  app: Hono,
  path: string,
  overrides: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> {
  const { method = "GET", body, headers = {} } = overrides;
  return app.request(path, {
    method,
    headers: {
      "content-type": "application/json",
      ...AUTH_HEADERS,
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as Promise<Response>;
}

describe("/api/v1/webhooks — auth", () => {
  it("returns 401 without a bearer token", async () => {
    const res = await makeApp().request("/api/v1/webhooks", { headers: {} });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { message: "Invalid OAuth access token", type: "OAuthException", code: 190 },
    });
  });
});

describe("POST /api/v1/webhooks", () => {
  it("creates a config and returns the snake_case JSON with 201", async () => {
    const app = makeApp();
    const res = await apiRequest(app, "/api/v1/webhooks", {
      method: "POST",
      body: {
        phone_number_id: "12345",
        webhook_url: "https://hooks.example.com/wa",
      },
    });

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toMatchObject({
      phone_number_id: "12345",
      webhook_url: "https://hooks.example.com/wa",
      enabled: true,
      max_retries: 3,
      retry_delay_ms: 1000,
      timeout_ms: 10000,
    });
    expect(json.webhook_secret).toBe("generated-secret");
    expect(json.serial).toBeDefined();
  });

  it("rejects an invalid webhook_url with 400", async () => {
    const res = await apiRequest(makeApp(), "/api/v1/webhooks", {
      method: "POST",
      body: { phone_number_id: "12345", webhook_url: "not-a-url" },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe("webhook_url must be a valid http(s) URL");
  });

  it("rejects an empty phone_number_id with 400", async () => {
    const res = await apiRequest(makeApp(), "/api/v1/webhooks", {
      method: "POST",
      body: { phone_number_id: "", webhook_url: "https://hooks.example.com/wa" },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe("phone_number_id is required");
  });

  it("returns 400 on an unparseable body", async () => {
    const res = await makeApp().request("/api/v1/webhooks", {
      method: "POST",
      headers: { ...AUTH_HEADERS, "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe(100);
  });
});

describe("GET /api/v1/webhooks", () => {
  it("lists configs", async () => {
    const management = new FakeWebhookConfigManagement([SAMPLE_CONFIG]);
    const res = await apiRequest(makeApp(undefined, undefined, {}, undefined, management), "/api/v1/webhooks");

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.webhooks).toHaveLength(1);
    expect(json.webhooks[0]).toMatchObject({ serial: "cfg-serial-1", webhook_url: "https://hooks.example.com/wa" });
  });
});

describe("GET /api/v1/webhooks/:serial", () => {
  it("returns the config", async () => {
    const management = new FakeWebhookConfigManagement([SAMPLE_CONFIG]);
    const res = await apiRequest(makeApp(undefined, undefined, {}, undefined, management), "/api/v1/webhooks/cfg-serial-1");

    expect(res.status).toBe(200);
    expect((await res.json()).serial).toBe("cfg-serial-1");
  });

  it("returns 404 for an unknown serial", async () => {
    const res = await apiRequest(makeApp(), "/api/v1/webhooks/nope");
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toBe("Webhook config not found");
  });
});

describe("PATCH /api/v1/webhooks/:serial", () => {
  it("updates fields and returns the updated config", async () => {
    const management = new FakeWebhookConfigManagement([SAMPLE_CONFIG]);
    const res = await apiRequest(makeApp(undefined, undefined, {}, undefined, management), "/api/v1/webhooks/cfg-serial-1", {
      method: "PATCH",
      body: { enabled: false, max_retries: 5 },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ enabled: false, max_retries: 5 });
  });

  it("returns 404 for an unknown serial", async () => {
    const res = await apiRequest(makeApp(), "/api/v1/webhooks/nope", {
      method: "PATCH",
      body: { enabled: false },
    });
    expect(res.status).toBe(404);
  });

  it("rejects an invalid URL with 400", async () => {
    const management = new FakeWebhookConfigManagement([SAMPLE_CONFIG]);
    const res = await apiRequest(makeApp(undefined, undefined, {}, undefined, management), "/api/v1/webhooks/cfg-serial-1", {
      method: "PATCH",
      body: { webhook_url: "ftp://x" },
    });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/v1/webhooks/:serial", () => {
  it("soft-deletes and returns ok", async () => {
    const management = new FakeWebhookConfigManagement([SAMPLE_CONFIG]);
    const res = await apiRequest(makeApp(undefined, undefined, {}, undefined, management), "/api/v1/webhooks/cfg-serial-1", {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 404 for an unknown serial", async () => {
    const res = await apiRequest(makeApp(), "/api/v1/webhooks/nope", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

describe("/api/v1/webhooks/:serial/subscriptions", () => {
  it("GET lists subscriptions", async () => {
    const management = new FakeWebhookConfigManagement([SAMPLE_CONFIG]);
    const res = await apiRequest(makeApp(undefined, undefined, {}, undefined, management), "/api/v1/webhooks/cfg-serial-1/subscriptions");

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.subscriptions).toHaveLength(1);
    expect(json.subscriptions[0].event_type).toBe("messages");
  });

  it("GET returns 404 for an unknown config", async () => {
    const res = await apiRequest(makeApp(), "/api/v1/webhooks/nope/subscriptions");
    expect(res.status).toBe(404);
  });

  it("POST adds a subscription", async () => {
    const management = new FakeWebhookConfigManagement([SAMPLE_CONFIG]);
    const res = await apiRequest(makeApp(undefined, undefined, {}, undefined, management), "/api/v1/webhooks/cfg-serial-1/subscriptions", {
      method: "POST",
      body: { event_type: "contacts" },
    });

    expect(res.status).toBe(201);
    expect((await res.json()).event_type).toBe("contacts");
  });

  it("POST rejects an unsupported event_type with 400", async () => {
    const management = new FakeWebhookConfigManagement([SAMPLE_CONFIG]);
    const res = await apiRequest(makeApp(undefined, undefined, {}, undefined, management), "/api/v1/webhooks/cfg-serial-1/subscriptions", {
      method: "POST",
      body: { event_type: "bogus" },
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain("event_type must be one of");
  });

  it("DELETE removes a subscription", async () => {
    const management = new FakeWebhookConfigManagement([SAMPLE_CONFIG]);
    const res = await apiRequest(makeApp(undefined, undefined, {}, undefined, management), "/api/v1/webhooks/cfg-serial-1/subscriptions/messages", {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("POST /api/v1/sessions", () => {
  it("echoes business_account_id in the response when provided", async () => {
    const res = await apiRequest(makeApp(), "/api/v1/sessions", {
      method: "POST",
      body: {
        phone_number_id: "12345",
        number: "62812345678",
        business_account_id: "waba-account-1",
      },
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      phone_number_id: "12345",
      business_account_id: "waba-account-1",
    });
  });

  it("carries an empty business_account_id when the body omits it", async () => {
    const res = await apiRequest(makeApp(), "/api/v1/sessions", {
      method: "POST",
      body: {
        phone_number_id: "12345",
        number: "62812345678",
      },
    });

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.business_account_id).toBe("");
  });
});
