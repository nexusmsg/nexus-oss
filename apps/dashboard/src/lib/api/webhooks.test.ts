import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { clearAuthHeader } from "./auth";
import {
  addSubscription,
  createWebhook,
  deleteWebhook,
  getWebhook,
  listSubscriptions,
  listWebhooks,
  removeSubscription,
  updateWebhook,
} from "./webhooks";
import type { WebhookConfig, WebhookSubscription } from "./types";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers({ "Content-Type": "application/json" }),
    async text() {
      return JSON.stringify(body);
    },
    async json() {
      return body;
    },
  } as unknown as Response;
}

function makeWebhook(overrides: Partial<WebhookConfig> = {}): WebhookConfig {
  return {
    id: 1,
    serial: "cfg_1",
    phone_number_id: "123",
    webhook_url: "https://hooks.example.com/wa",
    webhook_secret: "plain-secret",
    enabled: true,
    max_retries: 3,
    retry_delay_ms: 1000,
    timeout_ms: 10000,
    created_at: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

function makeSubscription(eventType = "messages"): WebhookSubscription {
  return {
    id: 10,
    serial: `sub_${eventType}`,
    webhook_config_id: 1,
    event_type: eventType,
    created_at: "2026-08-10T00:00:00.000Z",
  };
}

describe("webhook api functions", () => {
  let fetchMock: Mock;

  beforeEach(() => {
    clearAuthHeader();
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    clearAuthHeader();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("listWebhooks hits GET /webhooks and maps the { webhooks } envelope", async () => {
    const webhooks = [makeWebhook(), makeWebhook({ serial: "cfg_2" })];
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ webhooks }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listWebhooks()).resolves.toEqual(webhooks);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/webhooks");
    expect(init.method).toBe("GET");
  });

  it("createWebhook POSTs the snake_case payload and returns the created config", async () => {
    const created = makeWebhook({ webhook_secret: "generated-secret" });
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(created, 201));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createWebhook({
        phone_number_id: "123",
        webhook_url: "https://hooks.example.com/wa",
        webhook_secret: "my-secret",
      }),
    ).resolves.toEqual(created);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/webhooks");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      phone_number_id: "123",
      webhook_url: "https://hooks.example.com/wa",
      webhook_secret: "my-secret",
    });
  });

  it("getWebhook GETs the config by serial", async () => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(makeWebhook()));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getWebhook("cfg_1")).resolves.toEqual(makeWebhook());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/webhooks/cfg_1");
    expect(init.method).toBe("GET");
  });

  it("updateWebhook PATCHes the body and returns the updated config", async () => {
    const updated = makeWebhook({ enabled: false, max_retries: 5 });
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(updated));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      updateWebhook("cfg_1", { enabled: false, max_retries: 5 }),
    ).resolves.toEqual(updated);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/webhooks/cfg_1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ enabled: false, max_retries: 5 });
  });

  it("deleteWebhook DELETEs the config by serial", async () => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteWebhook("cfg_1")).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/webhooks/cfg_1");
    expect(init.method).toBe("DELETE");
  });

  it("encodes serials in the URL", async () => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(makeWebhook()));
    vi.stubGlobal("fetch", fetchMock);

    await getWebhook("a/b c");
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("/api/v1/webhooks/a%2Fb%20c");
  });

  it("preserves the plaintext webhook_secret from the API response", async () => {
    fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(makeWebhook({ webhook_secret: "raw-secret" })));
    vi.stubGlobal("fetch", fetchMock);

    const config = await getWebhook("cfg_1");
    expect(config.webhook_secret).toBe("raw-secret");
  });

  it("listSubscriptions GETs and maps the { subscriptions } envelope", async () => {
    fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ subscriptions: [makeSubscription()] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listSubscriptions("cfg_1")).resolves.toEqual([makeSubscription()]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/webhooks/cfg_1/subscriptions");
    expect(init.method).toBe("GET");
  });

  it("addSubscription POSTs an event_type", async () => {
    fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(makeSubscription("message_status"), 201));
    vi.stubGlobal("fetch", fetchMock);

    await expect(addSubscription("cfg_1", "message_status")).resolves.toEqual(
      makeSubscription("message_status"),
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/webhooks/cfg_1/subscriptions");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ event_type: "message_status" });
  });

  it("removeSubscription DELETEs the event type", async () => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(removeSubscription("cfg_1", "message_status")).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "/api/v1/webhooks/cfg_1/subscriptions/message_status",
    );
    expect(init.method).toBe("DELETE");
  });
});
