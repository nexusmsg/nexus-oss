import { describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { Config } from "./config.js";
import { createApp } from "./app.js";
import type { EnqueueInput, JobTransport, PollResult, WebhookConfigRow } from "./transport.js";
import app from "./index.js";

/**
 * In-memory JobTransport so the HTTP surface is exercised without any network
 * I/O. Behavior is driven by constructor options.
 */
class FakeTransport implements JobTransport {
  enqueueCalls: EnqueueInput[] = [];
  pollCalls: string[] = [];

  constructor(
    private readonly opts: {
      serial?: string;
      pollResult?: PollResult | null;
      pollBehavior?: () => PollResult | null;
      webhookConfig?: WebhookConfigRow | null;
    } = {},
  ) {}

  async enqueue(input: EnqueueInput): Promise<string> {
    this.enqueueCalls.push(input);
    return this.opts.serial ?? "11111111-1111-1111-1111-111111111111";
  }

  async poll(serial: string): Promise<PollResult | null> {
    this.pollCalls.push(serial);
    if (this.opts.pollBehavior !== undefined) {
      return this.opts.pollBehavior();
    }
    return (
      this.opts.pollResult ?? {
        status: "succeeded",
        result: { wa_message_id: "wamid.test.123" },
        lastError: null,
      }
    );
  }

  async getWebhookConfig(_phoneNumberId: string): Promise<WebhookConfigRow | null> {
    return this.opts.webhookConfig ?? null;
  }
}

const SUCCESS_RESULT: PollResult = {
  status: "succeeded",
  result: { wa_message_id: "wamid.test.123" },
  lastError: null,
};

function makeApp(
  transport: JobTransport = new FakeTransport(),
  overrides: Partial<Config> = {},
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
  return createApp({ transport, config });
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
    const res = await app.request("/");
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
    const res = await sendRequest(makeApp(new FakeTransport(), { apiAuthToken: "" }), {
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
    const app = makeApp();
    const res = await app.request("/12345/messages", {
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

  it.each([["utility"], ["authentication"], ["service"]])(
    "accepts category %s",
    async (category) => {
      const res = await sendRequest(makeApp(), { body: { ...VALID_MESSAGE, category } });
      expect(res.status).toBe(200);
    },
  );
});

describe("POST /:phone_number_id/messages — send + poll", () => {
  it("returns the success envelope with the worker wamid", async () => {
    const transport = new FakeTransport({ pollResult: SUCCESS_RESULT });
    const res = await sendRequest(makeApp(transport), { path: "/12345/messages" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      messaging_product: "whatsapp",
      contacts: [{ input: "62812345678", wa_id: "62812345678" }],
      messages: [{ id: "wamid.test.123" }],
    });
    expect(transport.enqueueCalls).toHaveLength(1);
    expect(transport.enqueueCalls[0]).toEqual({
      phoneNumberId: "12345",
      payload: VALID_MESSAGE,
      idempotencyKey: undefined,
    });
  });

  it("returns 500 WABA envelope with lastError when the job failed", async () => {
    const transport = new FakeTransport({
      pollResult: { status: "failed", result: null, lastError: "recipient not on WhatsApp" },
    });
    const res = await sendRequest(makeApp(transport));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: {
        message: "recipient not on WhatsApp",
        type: "OAuthException",
        code: 131000,
      },
    });
  });

  it("returns 504 WABA envelope when the job never reaches a terminal state", async () => {
    const transport = new FakeTransport({
      pollBehavior: () => ({ status: "pending", result: null, lastError: null }),
    });
    const app = makeApp(transport, { sendTimeoutMs: 20, resultPollMs: 5 });
    const res = await sendRequest(app);

    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({
      error: { message: "Send timed out", type: "OAuthException", code: 131000 },
    });
    expect(transport.pollCalls.length).toBeGreaterThan(1);
  });

  it("returns 500 when the job succeeded without a wa_message_id", async () => {
    const transport = new FakeTransport({
      pollResult: { status: "succeeded", result: {}, lastError: null },
    });
    const res = await sendRequest(makeApp(transport));

    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe(131000);
  });
});

describe("POST /:phone_number_id/messages — idempotency", () => {
  it("passes the Idempotency-Key header to the transport", async () => {
    const transport = new FakeTransport();
    const res = await sendRequest(makeApp(transport), {
      headers: { "idempotency-key": "key-from-header" },
    });
    expect(res.status).toBe(200);
    expect(transport.enqueueCalls[0].idempotencyKey).toBe("key-from-header");
  });

  it("falls back to the body idempotency_key when no header is sent", async () => {
    const transport = new FakeTransport();
    const res = await sendRequest(makeApp(transport), {
      body: { ...VALID_MESSAGE, idempotency_key: "key-from-body" },
    });
    expect(res.status).toBe(200);
    expect(transport.enqueueCalls[0].idempotencyKey).toBe("key-from-body");
    // The idempotency key is kept out of the stored payload.
    expect(transport.enqueueCalls[0].payload).toEqual(VALID_MESSAGE);
  });

  it("lets the header win over the body idempotency_key", async () => {
    const transport = new FakeTransport();
    const res = await sendRequest(makeApp(transport), {
      headers: { "idempotency-key": "header-wins" },
      body: { ...VALID_MESSAGE, idempotency_key: "body-loses" },
    });
    expect(res.status).toBe(200);
    expect(transport.enqueueCalls[0].idempotencyKey).toBe("header-wins");
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
    const res = await makeApp(new FakeTransport(), { internalToken: "" }).request(
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
    const transport = new FakeTransport({
      webhookConfig: { webhook_url: "https://hooks.example.com/wa", webhook_secret: "s3cret" },
    });
    const res = await makeApp(transport).request("/internal/webhook-config?phone_number_id=123", {
      headers: baseHeaders,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      webhook_url: "https://hooks.example.com/wa",
      webhook_secret: "s3cret",
    });
  });

  it("includes webhook_secret as null when it is unset", async () => {
    const transport = new FakeTransport({
      webhookConfig: { webhook_url: "https://hooks.example.com/wa", webhook_secret: null },
    });
    const res = await makeApp(transport).request("/internal/webhook-config?phone_number_id=123", {
      headers: baseHeaders,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      webhook_url: "https://hooks.example.com/wa",
      webhook_secret: null,
    });
  });

  it("returns 404 when no config exists for the phone number", async () => {
    const transport = new FakeTransport({ webhookConfig: null });
    const res = await makeApp(transport).request(
      "/internal/webhook-config?phone_number_id=unknown",
      { headers: baseHeaders },
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { message: "Webhook config not found", type: "OAuthException", code: 100 },
    });
  });
});
