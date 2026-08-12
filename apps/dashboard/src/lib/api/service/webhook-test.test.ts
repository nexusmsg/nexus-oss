/**
 * Tests for the one-shot webhook test:
 *
 * - Unit: pure payload builder, HMAC signature, and the SSRF URL guard
 *   (`isBlockedIpAddress`, `checkDeliveryTarget`).
 * - Functional: `TestWebhookService` against an in-memory fake transport and
 *   a fake forwarder — signature header, disabled-config probing, structured
 *   results for responses/failures, and blocked/invalid targets.
 */

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { RequestAbortedError, ValidationError } from "../domain/errors";
import type { WebhookConfig } from "../domain/webhook-config";
import type { WebhookConfigManagementTransport } from "../ports/webhook-config-management";
import type {
  WebhookForwardRequest,
  WebhookForwardResponse,
  WebhookForwardResult,
} from "../ports/webhook-forwarder";
import {
  TestWebhookService,
  buildSyntheticWebhookPayload,
  checkDeliveryTarget,
  computeSignature,
  isBlockedIpAddress,
} from "./webhook-test";

function makeConfig(overrides: Partial<WebhookConfig> = {}): WebhookConfig {
  return {
    id: 1,
    serial: "cfg_1",
    phoneNumberId: "123",
    webhookUrl: "https://hooks.example.com/wa",
    webhookSecret: "plain-secret",
    enabled: true,
    maxRetries: 3,
    retryDelayMs: 1000,
    timeoutMs: 10000,
    createdAt: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

/** Minimal in-memory transport; only `getConfig` is exercised by the service. */
class FakeTransport implements WebhookConfigManagementTransport {
  constructor(private readonly config: WebhookConfig | null) {}

  async getConfig(): Promise<WebhookConfig | null> {
    return this.config;
  }

  async getConfigByPhoneNumberId(): Promise<WebhookConfig | null> {
    throw new Error("unused");
  }
  async listConfigs(): Promise<WebhookConfig[]> {
    throw new Error("unused");
  }
  async createConfig(): Promise<WebhookConfig> {
    throw new Error("unused");
  }
  async updateConfig(): Promise<WebhookConfig> {
    throw new Error("unused");
  }
  async deleteConfig(): Promise<void> {
    throw new Error("unused");
  }
  async listSubscriptions(): Promise<never[]> {
    throw new Error("unused");
  }
  async addSubscription(): Promise<never> {
    throw new Error("unused");
  }
  async removeSubscription(): Promise<void> {
    throw new Error("unused");
  }
}

class FakeForwarder {
  calls: WebhookForwardRequest[] = [];
  constructor(private readonly result: WebhookForwardResult) {}

  async post(request: WebhookForwardRequest): Promise<WebhookForwardResult> {
    this.calls.push(request);
    return this.result;
  }
}

function responseResult(
  status: number,
  overrides: Partial<WebhookForwardResponse> = {},
): WebhookForwardResult {
  return {
    kind: "response",
    response: {
      status,
      statusText: status === 200 ? "OK" : `Status ${status}`,
      headers: { "content-type": "application/json" },
      body: null,
      bodyTruncated: false,
      ...overrides,
    },
  };
}

describe("buildSyntheticWebhookPayload", () => {
  it("is deterministic for a given config", () => {
    const config = makeConfig();
    expect(buildSyntheticWebhookPayload(config)).toEqual(
      buildSyntheticWebhookPayload(makeConfig()),
    );
  });

  it("is a valid WABA messages payload seeded from the config", () => {
    const payload = buildSyntheticWebhookPayload(makeConfig({ phoneNumberId: "456" }));

    expect(payload.object).toBe("whatsapp_business_account");
    expect(payload.entry[0].id).toBe("wa_456");
    expect(payload.entry[0].changes[0].field).toBe("messages");
    expect(payload.entry[0].changes[0].value.messaging_product).toBe("whatsapp");
    expect(payload.entry[0].changes[0].value.metadata).toEqual({
      display_phone_number: "456",
      phone_number_id: "456",
    });
    expect(payload.entry[0].changes[0].value.contacts[0].wa_id).toBe("14155552671");
    const message = payload.entry[0].changes[0].value.messages[0];
    expect(message).toEqual({
      from: "14155552671",
      id: "wamid.test.456",
      timestamp: "1760000000",
      type: "text",
      text: { body: "Webhook delivery test" },
    });
  });
});

describe("computeSignature", () => {
  it("matches the plaintext-secret HMAC-SHA256 algorithm (worker-compatible)", () => {
    const body = JSON.stringify({ hello: "world" });
    const expected = createHmac("sha256", "plain-secret")
      .update(body, "utf8")
      .digest("hex");

    expect(computeSignature("plain-secret", body)).toBe(expected);
  });

  it("is sensitive to the secret", () => {
    const body = "body";
    expect(computeSignature("secret-a", body)).not.toBe(
      computeSignature("secret-b", body),
    );
  });
});

describe("isBlockedIpAddress", () => {
  it.each([
    ["127.0.0.1"],
    ["127.8.8.8"],
    ["10.0.0.1"],
    ["172.16.0.1"],
    ["172.31.255.255"],
    ["192.168.1.1"],
    ["192.168.255.1"],
    ["169.254.0.1"],
    ["169.254.169.254"], // cloud metadata
    ["0.0.0.0"],
    ["224.0.0.1"], // multicast
    ["255.255.255.255"], // broadcast
    ["::1"],
    ["::"],
    ["fe80::1"], // link-local
    ["fc00::1"], // ULA private
    ["fd12:3456:789a::1"], // ULA private
    ["ff02::1"], // multicast
    ["::ffff:127.0.0.1"], // IPv4-mapped loopback
    ["::ffff:10.0.0.1"], // IPv4-mapped private
    ["::ffff:7f00:1"], // IPv4-mapped loopback (hex form, URL-normalized)
  ])("blocks %s", (ip) => {
    expect(isBlockedIpAddress(ip)).toBe(true);
  });

  it.each([
    ["8.8.8.8"],
    ["1.1.1.1"],
    ["93.184.216.34"],
    ["172.15.0.1"],
    ["172.32.0.1"],
    ["192.169.1.1"],
    ["192.169.1.1"],
    ["2001:4860:4860::8888"],
    ["::ffff:8.8.8.8"], // IPv4-mapped public
    ["2606:4700:4700::1111"],
  ])("allows %s", (ip) => {
    expect(isBlockedIpAddress(ip)).toBe(false);
  });

  it("returns false for non-IP strings", () => {
    expect(isBlockedIpAddress("hooks.example.com")).toBe(false);
    expect(isBlockedIpAddress("")).toBe(false);
  });
});

describe("checkDeliveryTarget", () => {
  const resolve = (addresses: string[] | "throw"): (() => Promise<string[]>) => {
    return async () => {
      if (addresses === "throw") throw new Error("ENOTFOUND");
      return addresses;
    };
  };

  it("blocks a literal loopback target without resolving", async () => {
    const resolver = resolve(["8.8.8.8"]);
    const check = await checkDeliveryTarget(
      new URL("http://127.0.0.1:8080/hook"),
      resolver,
    );
    expect(check).toEqual({
      ok: false,
      errorCode: "blocked_target",
      errorMessage: "webhook_url targets a blocked address (127.0.0.1)",
    });
  });

  it("blocks a literal IPv6 loopback target", async () => {
    const check = await checkDeliveryTarget(new URL("http://[::1]:8080/hook"), resolve([]));
    expect(check.ok).toBe(false);
    expect(check.errorCode).toBe("blocked_target");
  });

  it("allows a literal public IP target without resolving", async () => {
    const resolver = resolve(["10.0.0.1"]);
    const check = await checkDeliveryTarget(new URL("http://8.8.8.8/hook"), resolver);
    expect(check).toEqual({ ok: true });
  });

  it("blocks a hostname that resolves to a private address", async () => {
    const check = await checkDeliveryTarget(
      new URL("https://internal.local/hook"),
      resolve(["10.0.0.5"]),
    );
    expect(check).toEqual({
      ok: false,
      errorCode: "blocked_target",
      errorMessage: "webhook_url resolves to a blocked address (10.0.0.5)",
    });
  });

  it("blocks a hostname that resolves to any blocked address in a mix", async () => {
    const check = await checkDeliveryTarget(
      new URL("https://mixed.local/hook"),
      resolve(["93.184.216.34", "192.168.1.1"]),
    );
    expect(check.ok).toBe(false);
    expect(check.errorCode).toBe("blocked_target");
  });

  it("allows a hostname that resolves only to public addresses", async () => {
    const check = await checkDeliveryTarget(
      new URL("https://hooks.example.com/wa"),
      resolve(["93.184.216.34", "2606:4700:4700::1111"]),
    );
    expect(check).toEqual({ ok: true });
  });

  it("reports dns_failed when resolution throws", async () => {
    const check = await checkDeliveryTarget(
      new URL("https://nope.invalid/hook"),
      resolve("throw"),
    );
    expect(check).toEqual({
      ok: false,
      errorCode: "dns_failed",
      errorMessage: "webhook_url host could not be resolved (nope.invalid)",
    });
  });

  it("reports dns_failed when resolution returns no addresses", async () => {
    const check = await checkDeliveryTarget(
      new URL("https://nope.invalid/hook"),
      resolve([]),
    );
    expect(check.ok).toBe(false);
    expect(check.errorCode).toBe("dns_failed");
  });
});

describe("TestWebhookService", () => {
  const timeoutMs = 5000;

  function makeService(config: WebhookConfig | null, forwarder: FakeForwarder) {
    return new TestWebhookService({
      transport: new FakeTransport(config),
      forwarder,
      timeoutMs,
      resolveAddresses: async () => ["93.184.216.34"],
    });
  }

  it("returns null for an unknown serial", async () => {
    const service = makeService(null, new FakeForwarder(responseResult(200)));
    await expect(service.test("nope")).resolves.toBeNull();
  });

  it("probes a disabled (enabled=false) config", async () => {
    const forwarder = new FakeForwarder(responseResult(200));
    const service = makeService(makeConfig({ enabled: false }), forwarder);

    const result = await service.test("cfg_1");

    expect(result?.outcome).toBe("responded");
    expect(result?.ok).toBe(true);
    expect(forwarder.calls).toHaveLength(1);
  });

  it("POSTs the synthetic payload with a signature header when a secret is set", async () => {
    const forwarder = new FakeForwarder(responseResult(200));
    const service = makeService(makeConfig(), forwarder);

    const result = await service.test("cfg_1");

    expect(forwarder.calls).toHaveLength(1);
    const [request] = forwarder.calls;
    expect(request.url).toBe("https://hooks.example.com/wa");
    expect(request.timeoutMs).toBe(timeoutMs);
    expect(request.headers["Content-Type"]).toBe("application/json");

    const expectedBody = JSON.stringify(buildSyntheticWebhookPayload(makeConfig()));
    expect(request.body).toBe(expectedBody);
    const expectedSignature = createHmac("sha256", "plain-secret")
      .update(request.body, "utf8")
      .digest("hex");
    expect(request.headers["X-Hub-Signature-256"]).toBe(`sha256=${expectedSignature}`);

    expect(result?.signatureSent).toBe(true);
    expect(result?.payload).toEqual(JSON.parse(request.body));
  });

  it("does not attach a signature header when the secret is empty", async () => {
    const forwarder = new FakeForwarder(responseResult(200));
    const service = makeService(makeConfig({ webhookSecret: null }), forwarder);

    await service.test("cfg_1");

    expect(forwarder.calls[0].headers["X-Hub-Signature-256"]).toBeUndefined();
  });

  it("returns a responded result for a 2xx endpoint", async () => {
    const forwarder = new FakeForwarder(
      responseResult(200, { body: '{"ok":true}', statusText: "OK" }),
    );
    const service = makeService(makeConfig(), forwarder);

    const result = await service.test("cfg_1");

    expect(result).toMatchObject({
      outcome: "responded",
      ok: true,
      status: 200,
      statusText: "OK",
      body: '{"ok":true}',
      bodyTruncated: false,
      error: null,
    });
    expect(result?.durationMs).toBeGreaterThanOrEqual(0);
    expect(result?.headers).toEqual({ "content-type": "application/json" });
  });

  it("returns a responded result with ok=false for a 5xx endpoint", async () => {
    const forwarder = new FakeForwarder(responseResult(503));
    const service = makeService(makeConfig(), forwarder);

    const result = await service.test("cfg_1");

    expect(result).toMatchObject({
      outcome: "responded",
      ok: false,
      status: 503,
      error: null,
    });
  });

  it("surfaces a 3xx redirect as a responded result (never followed)", async () => {
    const forwarder = new FakeForwarder(
      responseResult(301, { headers: { location: "https://elsewhere.example.com" }, statusText: "Moved Permanently" }),
    );
    const service = makeService(makeConfig(), forwarder);

    const result = await service.test("cfg_1");

    expect(result).toMatchObject({
      outcome: "responded",
      ok: false,
      status: 301,
      headers: { location: "https://elsewhere.example.com" },
    });
  });

  it("reports a timeout as a failed result with code timeout", async () => {
    const forwarder = new FakeForwarder({ kind: "timeout" });
    const service = makeService(makeConfig(), forwarder);

    const result = await service.test("cfg_1");

    expect(result?.outcome).toBe("failed");
    expect(result?.status).toBeNull();
    expect(result?.error).toEqual({ code: "timeout", message: "webhook request timed out" });
    expect(result?.signatureSent).toBe(true);
  });

  it("reports a network error as a failed result with code network", async () => {
    const forwarder = new FakeForwarder({ kind: "network", message: "socket hang up" });
    const service = makeService(makeConfig(), forwarder);

    const result = await service.test("cfg_1");

    expect(result?.outcome).toBe("failed");
    expect(result?.error).toEqual({ code: "network", message: "socket hang up" });
  });

  it("rethrows RequestAbortedError when the caller aborts", async () => {
    const forwarder = new FakeForwarder({ kind: "aborted", message: "request aborted" });
    const service = makeService(makeConfig(), forwarder);

    await expect(service.test("cfg_1")).rejects.toThrow(RequestAbortedError);
  });

  it("rejects a blocked target without calling the forwarder", async () => {
    const forwarder = new FakeForwarder(responseResult(200));
    const service = makeService(makeConfig({ webhookUrl: "http://127.0.0.1:8080/hook" }), forwarder);

    const result = await service.test("cfg_1");

    expect(result?.outcome).toBe("failed");
    expect(result?.error?.code).toBe("blocked_target");
    expect(forwarder.calls).toHaveLength(0);
  });

  it("rejects a hostname that resolves to a blocked address without calling the forwarder", async () => {
    const forwarder = new FakeForwarder(responseResult(200));
    const service = new TestWebhookService({
      transport: new FakeTransport(makeConfig()),
      forwarder,
      timeoutMs,
      resolveAddresses: async () => ["169.254.169.254"],
    });

    const result = await service.test("cfg_1");

    expect(result?.error?.code).toBe("blocked_target");
    expect(result?.error?.message).toBe(
      "webhook_url resolves to a blocked address (169.254.169.254)",
    );
    expect(forwarder.calls).toHaveLength(0);
  });

  it("throws ValidationError for an invalid webhook_url (WABA 400 envelope input)", async () => {
    const forwarder = new FakeForwarder(responseResult(200));
    const service = makeService(makeConfig({ webhookUrl: "ftp://x" }), forwarder);

    await expect(service.test("cfg_1")).rejects.toThrow(ValidationError);
    await expect(service.test("cfg_1")).rejects.toThrow(
      "webhook_url must be a valid http(s) URL",
    );
    expect(forwarder.calls).toHaveLength(0);
  });

  it("throws ValidationError for an unparseable webhook_url", async () => {
    const forwarder = new FakeForwarder(responseResult(200));
    const service = makeService(makeConfig({ webhookUrl: "not-a-url" }), forwarder);

    await expect(service.test("cfg_1")).rejects.toThrow(ValidationError);
    expect(forwarder.calls).toHaveLength(0);
  });

  it("reports dns_failed when the injected resolver returns nothing", async () => {
    const forwarder = new FakeForwarder(responseResult(200));
    const service = new TestWebhookService({
      transport: new FakeTransport(makeConfig()),
      forwarder,
      timeoutMs,
      resolveAddresses: async () => [],
    });

    const result = await service.test("cfg_1");

    expect(result?.error?.code).toBe("dns_failed");
    expect(forwarder.calls).toHaveLength(0);
  });
});
