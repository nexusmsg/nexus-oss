/**
 * Route tests for GET /api/v1/observability and
 * GET /api/v1/observability/[serial]. Composition and config are mocked so the
 * handler's bootstrap-only auth, WABA error-envelope, filter parsing, and JSON
 * mapping behavior can be asserted without a database.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ActivityEventView } from "@/lib/api/domain/observability";
import { GET as listHandler } from "./route";
import { GET as detailHandler } from "./[serial]/route";

const mocks = vi.hoisted(() => ({
  composeServices: vi.fn(),
  loadConfig: vi.fn(),
  list: vi.fn(),
  detail: vi.fn(),
}));

vi.mock("@/lib/api/compose", () => ({
  composeServices: mocks.composeServices,
}));
vi.mock("@/lib/api/config", () => ({
  loadConfig: mocks.loadConfig,
}));

function request(method: "GET", token: string, url = "http://localhost/api/v1/observability"): NextRequest {
  return new NextRequest(url, {
    method,
    headers: token === "" ? {} : { Authorization: `Bearer ${token}` },
  });
}

function activity(overrides: Partial<ActivityEventView> = {}): ActivityEventView {
  return {
    serial: "act_1",
    type: "api_request",
    status: "ok",
    phoneNumberId: null,
    businessAccountId: "",
    summary: "GET /api/v1/sessions",
    jobSerial: null,
    waMessageId: null,
    sourceActivitySerial: null,
    resourceType: null,
    resourceSerial: null,
    requestSerial: null,
    payload: {},
    createdAt: "2026-08-12T00:00:00.000Z",
    ...overrides,
  };
}

describe("GET /api/v1/observability (bootstrap-only auth)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a missing or wrong token with the WABA 401 envelope", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });

    const missing = await listHandler(request("GET", ""));
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({
      error: { message: "Invalid OAuth access token", type: "OAuthException", code: 401 },
    });
    expect(mocks.composeServices).not.toHaveBeenCalled();

    const wrong = await listHandler(request("GET", "wrong"));
    expect(wrong.status).toBe(401);
    expect(mocks.composeServices).not.toHaveBeenCalled();
  });

  it("rejects a persisted-key-shaped credential (bootstrap-only)", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "bootstrap-tok" });

    const res = await listHandler(request("GET", "waba_dev_0123456789abcdef0123456789abcdef"));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { message: "Invalid OAuth access token", type: "OAuthException", code: 401 },
    });
    expect(mocks.composeServices).not.toHaveBeenCalled();
  });

  it("returns 401 when the configured bootstrap token is empty", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "" });

    const res = await listHandler(request("GET", "anything"));

    expect(res.status).toBe(401);
    expect(mocks.composeServices).not.toHaveBeenCalled();
  });

  it("accepts the bootstrap token and returns the activities envelope", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({
      observability: { list: mocks.list, detail: mocks.detail },
    });
    mocks.list.mockResolvedValue({
      activities: [activity(), activity({ serial: "act_2", type: "whatsapp_event" })],
    });

    const res = await listHandler(request("GET", "tok"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      activities: [
        activity(),
        activity({ serial: "act_2", type: "whatsapp_event" }),
      ],
    });
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it("parses valid filters and passes them to the service", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({
      observability: { list: mocks.list, detail: mocks.detail },
    });
    mocks.list.mockResolvedValue({ activities: [] });

    await listHandler(
      request(
        "GET",
        "tok",
        "http://localhost/api/v1/observability?type=api_request&status=error&phone_number_id=pn_1&limit=50",
      ),
    );

    expect(mocks.list).toHaveBeenCalledWith({
      type: "api_request",
      status: "error",
      phoneNumberId: "pn_1",
      limit: 50,
    });
  });

  it("returns 400 for an unknown type value", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({
      observability: { list: mocks.list, detail: mocks.detail },
    });

    const res = await listHandler(
      request("GET", "tok", "http://localhost/api/v1/observability?type=bogus"),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        message: "type must be one of: api_request, whatsapp_event, webhook_delivery",
        type: "OAuthException",
        code: 400,
      },
    });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-integer limit", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({
      observability: { list: mocks.list, detail: mocks.detail },
    });

    const res = await listHandler(
      request("GET", "tok", "http://localhost/api/v1/observability?limit=-3"),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        message: "limit must be a positive integer",
        type: "OAuthException",
        code: 400,
      },
    });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("passes no filter object fields when no query is supplied", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({
      observability: { list: mocks.list, detail: mocks.detail },
    });
    mocks.list.mockResolvedValue({ activities: [] });

    await listHandler(request("GET", "tok"));

    expect(mocks.list).toHaveBeenCalledWith({});
  });
});

describe("GET /api/v1/observability/[serial] (bootstrap-only auth)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  const detailParams = { params: Promise.resolve({ serial: "act_1" }) };

  it("rejects a persisted-key-shaped credential (bootstrap-only)", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "bootstrap-tok" });

    const res = await detailHandler(
      request("GET", "waba_dev_0123456789abcdef0123456789abcdef", "http://localhost/api/v1/observability/act_1"),
      detailParams,
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { message: "Invalid OAuth access token", type: "OAuthException", code: 401 },
    });
    expect(mocks.composeServices).not.toHaveBeenCalled();
  });

  it("returns the { activity, related } envelope on success", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({
      observability: { list: mocks.list, detail: mocks.detail },
    });
    mocks.detail.mockResolvedValue({
      activity: activity(),
      related: [activity({ serial: "act_2", type: "whatsapp_event" })],
    });

    const res = await detailHandler(
      request("GET", "tok", "http://localhost/api/v1/observability/act_1"),
      detailParams,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      activity: activity(),
      related: [activity({ serial: "act_2", type: "whatsapp_event" })],
    });
    expect(mocks.detail).toHaveBeenCalledWith("act_1");
  });

  it("returns a 404 envelope for an unknown serial", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({
      observability: { list: mocks.list, detail: mocks.detail },
    });
    mocks.detail.mockResolvedValue(null);

    const res = await detailHandler(
      request("GET", "tok", "http://localhost/api/v1/observability/act_x"),
      { params: Promise.resolve({ serial: "act_x" }) },
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { message: "Activity not found", type: "OAuthException", code: 404 },
    });
  });
});
