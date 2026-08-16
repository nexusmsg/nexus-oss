/**
 * Contract tests for the `authz` middleware (replaces the 401-side of the old
 * legacy capture suite). Composition and config are mocked. It asserts:
 *
 *  1. An unauthorized call short-circuits to the WABA 401 envelope WITHOUT
 *     invoking the inner chain, composing services, or recording a row.
 *  2. An authorized `bootstrap` identity is exposed to the inner handler as
 *     `identity` / `requestSerial === "bootstrap"`.
 *  3. `bootstrapOnly` routes reject persisted-key-shaped credentials with no
 *     hash lookup and no composition.
 *  4. An empty configured token closes every route (any credential → 401).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { authz } from "@/lib/api/authz";
import type { RouteHandler } from "@/lib/api/handler";

const mocks = vi.hoisted(() => ({
  composeServices: vi.fn(),
  loadConfig: vi.fn(),
  getKeyByHash: vi.fn(),
  touchKeyLastUsed: vi.fn(),
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

const PERSISTED_KEY_CREDENTIAL = "waba_dev_0123456789abcdef0123456789abcdef";

function request(token: string): NextRequest {
  const headers: Record<string, string> = {};
  if (token !== "") headers["Authorization"] = `Bearer ${token}`;
  return new NextRequest("http://localhost/api/v1/sessions", {
    method: "GET",
    headers,
  });
}

/** Handler records the authz-populated identity, proving the chain ran. */
function captureHandler(
  seen: Array<{ identity: string | null; requestSerial: string | null }>,
): RouteHandler {
  return async (_req, ctx) => {
    seen.push({ identity: ctx.identity, requestSerial: ctx.requestSerial });
    return new Response("{}", { status: 200 }) as unknown as import("next/server").NextResponse;
  };
}

describe("authz — 401 short-circuit (R4 rejection stays dependency-free)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the WABA 401 envelope without invoking the inner handler, composing services, or recording", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    const seen: Array<{ identity: string | null; requestSerial: string | null }> = [];
    const wrapped = authz({ scope: "write" })(captureHandler(seen));

    const res = await wrapped(request(""));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(UNAUTHORIZED);
    expect(seen).toHaveLength(0);
    expect(mocks.composeServices).not.toHaveBeenCalled();
  });

  it("returns 401 for a wrong token without composing services", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    const seen: Array<{ identity: string | null; requestSerial: string | null }> = [];
    const wrapped = authz({ scope: "read" })(captureHandler(seen));

    const res = await wrapped(request("wrong"));

    expect(res.status).toBe(401);
    expect(seen).toHaveLength(0);
    expect(mocks.composeServices).not.toHaveBeenCalled();
  });

  it("closes the route when the bootstrap token is empty", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "" });
    const seen: Array<{ identity: string | null; requestSerial: string | null }> = [];
    const wrapped = authz({ scope: "read" })(captureHandler(seen));

    const res = await wrapped(request("anything"));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(UNAUTHORIZED);
    expect(seen).toHaveLength(0);
    expect(mocks.composeServices).not.toHaveBeenCalled();
    expect(mocks.getKeyByHash).not.toHaveBeenCalled();
  });
});

describe("authz — bootstrap identity", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes the bootstrap identity into the inner handler", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "bootstrap-tok" });
    const seen: Array<{ identity: string | null; requestSerial: string | null }> = [];
    const wrapped = authz({ scope: "write" })(captureHandler(seen));

    const res = await wrapped(request("bootstrap-tok"));

    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ identity: "bootstrap", requestSerial: "bootstrap" });
  });
});

describe("authz — bootstrapOnly management routes", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a persisted-key-shaped credential with no lookup and no composition", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "bootstrap-tok" });
    mocks.composeServices.mockReturnValue({
      apiKeyAuth: { getKeyByHash: mocks.getKeyByHash, touchKeyLastUsed: mocks.touchKeyLastUsed },
    });
    const seen: Array<{ identity: string | null; requestSerial: string | null }> = [];
    const wrapped = authz({ scope: "read", bootstrapOnly: true })(captureHandler(seen));

    const res = await wrapped(request(PERSISTED_KEY_CREDENTIAL));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(UNAUTHORIZED);
    expect(seen).toHaveLength(0);
    expect(mocks.getKeyByHash).not.toHaveBeenCalled();
    expect(mocks.composeServices).not.toHaveBeenCalled();
  });

  it("still accepts the bootstrap token on a bootstrapOnly route", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "bootstrap-tok" });
    const seen: Array<{ identity: string | null; requestSerial: string | null }> = [];
    const wrapped = authz({ scope: "read", bootstrapOnly: true })(captureHandler(seen));

    const res = await wrapped(request("bootstrap-tok"));

    expect(res.status).toBe(200);
    expect(seen[0].identity).toBe("bootstrap");
  });
});
