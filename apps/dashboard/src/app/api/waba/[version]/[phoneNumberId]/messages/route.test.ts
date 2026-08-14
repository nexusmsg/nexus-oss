/**
 * Route tests for POST /api/waba/:version/:phone_number_id/messages.
 * Composition and config are mocked so the handler's version validation,
 * auth, WABA error envelopes, and success mapping can be asserted without a
 * database or worker.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SendTimeoutError } from "@/lib/api/domain/errors";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  composeServices: vi.fn(),
  loadConfig: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@/lib/api/compose", () => ({
  composeServices: mocks.composeServices,
}));
vi.mock("@/lib/api/config", () => ({
  loadConfig: mocks.loadConfig,
}));

const PHONE_NUMBER_ID = "1001";
const ROUTE_URL = `http://localhost/api/waba/v26.0/${PHONE_NUMBER_ID}/messages`;

function request(token: string, body?: unknown, version = "v26.0"): NextRequest {
  return new NextRequest(`http://localhost/api/waba/${version}/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers:
      token === ""
        ? {}
        : { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function context(version = "v26.0"): { params: Promise<{ version: string; phoneNumberId: string }> } {
  return { params: Promise.resolve({ version, phoneNumberId: PHONE_NUMBER_ID }) };
}

const validBody = {
  messaging_product: "whatsapp",
  type: "text",
  to: "+6285293322073",
  text: { body: "Hello from Bruno!" },
};

describe("POST /api/waba/:version/:phone_number_id/messages", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 with the WABA envelope when auth is missing or wrong", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });

    const unauthorized = await POST(request("", validBody), context());
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({
      error: { message: "Invalid OAuth access token", type: "OAuthException", code: 401 },
    });
    expect(mocks.composeServices).not.toHaveBeenCalled();

    const wrongToken = await POST(request("wrong", validBody), context());
    expect(wrongToken.status).toBe(401);
    expect(mocks.composeServices).not.toHaveBeenCalled();
  });

  it("returns 400 for an unsupported version", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });

    const res = await POST(request("tok", validBody, "v27.0"), context("v27.0"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        message: "Unsupported API version 'v27.0'. Supported versions: v26.0",
        type: "OAuthException",
        code: 400,
      },
    });
    expect(mocks.composeServices).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed version", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });

    const res = await POST(request("tok", validBody, "v26"), context("v26"));

    expect(res.status).toBe(400);
    expect(mocks.composeServices).not.toHaveBeenCalled();
  });

  it("returns 400 for an unparseable body", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    const req = new NextRequest(ROUTE_URL, {
      method: "POST",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: "{not json",
    });

    const res = await POST(req, context());

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { message: "Invalid request body", type: "OAuthException", code: 400 },
    });
  });

  it("returns 400 with the validator message for an invalid payload", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({ sendMessage: { send: mocks.send } });

    const res = await POST(
      request("tok", { messaging_product: "telegram", type: "text", to: "1", text: { body: "hi" } }),
      context(),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { message: "messaging_product must be whatsapp", type: "OAuthException", code: 400 },
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("returns 200 with the official WABA envelope on success", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({ sendMessage: { send: mocks.send } });
    const wamid = "wamid.HBgLMTY0NjcwNDM1OTUVAgARGBI1RjQyNUE3NEYxMzAzMzQ5MkEA";
    mocks.send.mockResolvedValue({ status: "succeeded", wamid });

    const res = await POST(request("tok", validBody), context());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      messaging_product: "whatsapp",
      contacts: [{ input: "+6285293322073", wa_id: "6285293322073" }],
      messages: [{ id: wamid }],
    });
    expect(mocks.send).toHaveBeenCalledWith({
      phoneNumberId: PHONE_NUMBER_ID,
      payload: validBody,
      signal: expect.anything(),
    });
  });

  it("returns 500 with the worker reason in error_data.details on send failure", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({ sendMessage: { send: mocks.send } });
    mocks.send.mockResolvedValue({
      status: "failed",
      reason: 'executor: no sender for phone number id "1001"',
    });

    const res = await POST(request("tok", validBody), context());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: {
        message: "Message send failed",
        type: "OAuthException",
        code: 500,
        error_data: { details: 'executor: no sender for phone number id "1001"' },
      },
    });
  });

  it("returns 504 when the send poll times out", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({ sendMessage: { send: mocks.send } });
    mocks.send.mockRejectedValue(new SendTimeoutError());

    const res = await POST(request("tok", validBody), context());

    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({
      error: { message: "Message send timed out", type: "OAuthException", code: 504 },
    });
  });
});
