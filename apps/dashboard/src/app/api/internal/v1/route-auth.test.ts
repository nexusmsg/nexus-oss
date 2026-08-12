/**
 * Route-level internal-token isolation (API-5a).
 *
 * `/api/internal/v1/**` handlers accept only `INTERNAL_TOKEN`. The bootstrap
 * `API_AUTH_TOKEN`, persisted-key-shaped credentials, and missing credentials
 * are rejected with the WABA 401 envelope before any service is composed; an
 * empty `INTERNAL_TOKEN` closes the routes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as heartbeatPost } from "./heartbeat/route";
import { GET as webhookConfigGet } from "./webhook-config/route";

const mocks = vi.hoisted(() => ({
  composeServices: vi.fn(),
  loadConfig: vi.fn(),
  heartbeat: vi.fn(),
  get: vi.fn(),
}));

vi.mock("@/lib/api/compose", () => ({
  composeServices: mocks.composeServices,
}));
vi.mock("@/lib/api/config", () => ({
  loadConfig: mocks.loadConfig,
}));

const UNAUTHORIZED = {
  error: { message: "Invalid OAuth access token", type: "OAuthException", code: 401 },
};

function internalReq(
  path: string,
  method: "GET" | "POST",
  token: string | null,
  query = "",
  body?: unknown,
): NextRequest {
  return new NextRequest(`http://localhost${path}${query}`, {
    method,
    headers: token === null ? {} : { Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("POST /api/internal/v1/heartbeat", () => {
  beforeEach(() => {
    vi.stubEnv("INTERNAL_TOKEN", "int-tok");
    mocks.loadConfig.mockReturnValue({ internalToken: "int-tok" });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("accepts INTERNAL_TOKEN and forwards the heartbeat", async () => {
    mocks.composeServices.mockReturnValue({
      sessionService: { heartbeat: mocks.heartbeat },
    });
    mocks.heartbeat.mockResolvedValue(undefined);

    const res = await heartbeatPost(
      internalReq("/api/internal/v1/heartbeat", "POST", "int-tok", "", {
        phone_number_id: "pn_1",
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.heartbeat).toHaveBeenCalledWith("pn_1");
  });

  it("rejects the bootstrap API_AUTH_TOKEN", async () => {
    const res = await heartbeatPost(
      internalReq("/api/internal/v1/heartbeat", "POST", "bootstrap-tok", "", {
        phone_number_id: "pn_1",
      }),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(UNAUTHORIZED);
    expect(mocks.composeServices).not.toHaveBeenCalled();
  });

  it("rejects a persisted-key-shaped credential", async () => {
    const res = await heartbeatPost(
      internalReq(
        "/api/internal/v1/heartbeat",
        "POST",
        "waba_dev_0123456789abcdef0123456789abcdef",
        "",
        { phone_number_id: "pn_1" },
      ),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(UNAUTHORIZED);
    expect(mocks.composeServices).not.toHaveBeenCalled();
  });

  it("is closed when INTERNAL_TOKEN is empty", async () => {
    vi.stubEnv("INTERNAL_TOKEN", "");
    mocks.loadConfig.mockReturnValue({ internalToken: "" });

    const res = await heartbeatPost(
      internalReq("/api/internal/v1/heartbeat", "POST", "int-tok", "", {
        phone_number_id: "pn_1",
      }),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(UNAUTHORIZED);
    expect(mocks.composeServices).not.toHaveBeenCalled();
  });
});

describe("GET /api/internal/v1/webhook-config", () => {
  beforeEach(() => {
    vi.stubEnv("INTERNAL_TOKEN", "int-tok");
    mocks.loadConfig.mockReturnValue({ internalToken: "int-tok" });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("accepts INTERNAL_TOKEN and returns the config", async () => {
    mocks.composeServices.mockReturnValue({ webhookConfig: { get: mocks.get } });
    mocks.get.mockResolvedValue({
      webhookUrl: "https://example.com/hook",
      webhookSecret: "secret",
    });

    const res = await webhookConfigGet(
      internalReq(
        "/api/internal/v1/webhook-config",
        "GET",
        "int-tok",
        "?phone_number_id=pn_1",
      ),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      webhook_url: "https://example.com/hook",
      webhook_secret: "secret",
    });
    expect(mocks.get).toHaveBeenCalledWith("pn_1");
  });

  it("rejects the bootstrap API_AUTH_TOKEN", async () => {
    const res = await webhookConfigGet(
      internalReq(
        "/api/internal/v1/webhook-config",
        "GET",
        "bootstrap-tok",
        "?phone_number_id=pn_1",
      ),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(UNAUTHORIZED);
    expect(mocks.composeServices).not.toHaveBeenCalled();
  });

  it("rejects a persisted-key-shaped credential", async () => {
    const res = await webhookConfigGet(
      internalReq(
        "/api/internal/v1/webhook-config",
        "GET",
        "waba_dev_0123456789abcdef0123456789abcdef",
        "?phone_number_id=pn_1",
      ),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(UNAUTHORIZED);
    expect(mocks.composeServices).not.toHaveBeenCalled();
  });

  it("is closed when INTERNAL_TOKEN is empty", async () => {
    vi.stubEnv("INTERNAL_TOKEN", "");
    mocks.loadConfig.mockReturnValue({ internalToken: "" });

    const res = await webhookConfigGet(
      internalReq(
        "/api/internal/v1/webhook-config",
        "GET",
        "int-tok",
        "?phone_number_id=pn_1",
      ),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(UNAUTHORIZED);
    expect(mocks.composeServices).not.toHaveBeenCalled();
  });
});
