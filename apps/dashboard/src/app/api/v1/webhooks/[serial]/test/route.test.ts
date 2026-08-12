/**
 * Route tests for POST /api/v1/webhooks/[serial]/test. Composition and config
 * are mocked so the handler's auth, error-envelope, and JSON mapping behavior
 * can be asserted without a database or real HTTP.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { RequestAbortedError, ValidationError } from "@/lib/api/domain/errors";
import type { WebhookProbeResult } from "@/lib/api/domain/webhook-test";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  composeServices: vi.fn(),
  loadConfig: vi.fn(),
  test: vi.fn(),
}));

vi.mock("@/lib/api/compose", () => ({
  composeServices: mocks.composeServices,
}));
vi.mock("@/lib/api/config", () => ({
  loadConfig: mocks.loadConfig,
}));

function request(token: string): NextRequest {
  return new NextRequest("http://localhost/api/v1/webhooks/cfg_1/test", {
    method: "POST",
    headers: token === "" ? {} : { Authorization: `Bearer ${token}` },
  });
}

function probeResult(overrides: Partial<WebhookProbeResult> = {}): WebhookProbeResult {
  return {
    outcome: "responded",
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { "content-type": "text/plain" },
    body: "ok",
    bodyTruncated: false,
    durationMs: 12,
    signatureSent: true,
    error: null,
    payload: {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "wa_123",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "123", phone_number_id: "123" },
                contacts: [{ profile: { name: "Webhook Test" }, wa_id: "14155552671" }],
                messages: [
                  {
                    from: "14155552671",
                    id: "wamid.test.123",
                    timestamp: "1760000000",
                    type: "text",
                    text: { body: "Webhook delivery test" },
                  },
                ],
              },
            },
          ],
        },
      ],
    },
    ...overrides,
  };
}

describe("POST /api/v1/webhooks/[serial]/test", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 with the WABA envelope when auth is missing or wrong", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });

    const unauthorized = await POST(request(""), {
      params: Promise.resolve({ serial: "cfg_1" }),
    });
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({
      error: { message: "Invalid OAuth access token", type: "OAuthException", code: 401 },
    });
    expect(mocks.composeServices).not.toHaveBeenCalled();

    const wrongToken = await POST(request("wrong"), {
      params: Promise.resolve({ serial: "cfg_1" }),
    });
    expect(wrongToken.status).toBe(401);
  });

  it("returns 404 with the WABA envelope when the config is not found", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({ webhookTest: { test: mocks.test } });
    mocks.test.mockResolvedValue(null);

    const res = await POST(request("tok"), {
      params: Promise.resolve({ serial: "nope" }),
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { message: "Webhook config not found", type: "OAuthException", code: 400 },
    });
    expect(mocks.test).toHaveBeenCalledWith("nope", expect.anything());
  });

  it("returns 400 with the WABA envelope for invalid input (ValidationError)", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({ webhookTest: { test: mocks.test } });
    mocks.test.mockRejectedValue(
      new ValidationError("webhook_url must be a valid http(s) URL"),
    );

    const res = await POST(request("tok"), {
      params: Promise.resolve({ serial: "cfg_1" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        message: "webhook_url must be a valid http(s) URL",
        type: "OAuthException",
        code: 400,
      },
    });
  });

  it("rethrows RequestAbortedError instead of mapping it to a response", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({ webhookTest: { test: mocks.test } });
    mocks.test.mockRejectedValue(new RequestAbortedError());

    await expect(
      POST(request("tok"), { params: Promise.resolve({ serial: "cfg_1" }) }),
    ).rejects.toThrow(RequestAbortedError);
  });

  it("returns 500 with the WABA envelope for unexpected service errors", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({ webhookTest: { test: mocks.test } });
    mocks.test.mockRejectedValue(new Error("boom"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const res = await POST(request("tok"), {
      params: Promise.resolve({ serial: "cfg_1" }),
    });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { message: "Internal server error", type: "OAuthException", code: 500 },
    });
    errorSpy.mockRestore();
  });

  it("returns the structured probe result under webhook_test on success", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({ webhookTest: { test: mocks.test } });
    const result = probeResult();
    mocks.test.mockResolvedValue(result);

    const res = await POST(request("tok"), {
      params: Promise.resolve({ serial: "cfg_1" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.webhook_test).toEqual({
      outcome: "responded",
      ok: true,
      status: 200,
      status_text: "OK",
      headers: { "content-type": "text/plain" },
      body: "ok",
      body_truncated: false,
      duration_ms: 12,
      signature_sent: true,
      error: null,
      payload: result.payload,
    });
  });

  it("maps failed probe results without error-envelope wrapping", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({ webhookTest: { test: mocks.test } });
    mocks.test.mockResolvedValue(
      probeResult({
        outcome: "failed",
        ok: false,
        status: null,
        statusText: "",
        headers: {},
        body: null,
        bodyTruncated: false,
        signatureSent: false,
        error: { code: "blocked_target", message: "webhook_url targets a blocked address (127.0.0.1)" },
      }),
    );

    const res = await POST(request("tok"), {
      params: Promise.resolve({ serial: "cfg_1" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.webhook_test.outcome).toBe("failed");
    expect(json.webhook_test.error.code).toBe("blocked_target");
  });
});
