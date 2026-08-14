/**
 * Route tests for GET /api/v1/api-keys/[serial]/secret. Composition and config
 * are mocked so the handler's auth, rate limit, WABA error envelopes, and
 * never-leak-the-secret behavior can be asserted without a database.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  ApiKeyRevokedError,
  KeySecretDecryptionError,
  KeySecretNotRecoverableError,
} from "@/lib/api/domain/errors";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  composeServices: vi.fn(),
  loadConfig: vi.fn(),
  revealKey: vi.fn(),
}));

vi.mock("@/lib/api/compose", () => ({
  composeServices: mocks.composeServices,
}));
vi.mock("@/lib/api/config", () => ({
  loadConfig: mocks.loadConfig,
}));

function request(token: string): NextRequest {
  return new NextRequest("http://localhost/api/v1/api-keys/key_1/secret", {
    method: "GET",
    headers: token === "" ? {} : { Authorization: `Bearer ${token}` },
  });
}

function paramsFor(serial: string) {
  return Promise.resolve({ serial });
}

describe("GET /api/v1/api-keys/[serial]/secret", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the bootstrap token is missing or wrong", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });

    for (const token of ["", "wrong"]) {
      const res = await GET(request(token), { params: paramsFor("s_401") });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        error: { message: "Invalid OAuth access token", type: "OAuthException", code: 401 },
      });
    }
    expect(mocks.composeServices).not.toHaveBeenCalled();
  });

  it("returns 404 when the serial is absent", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({ apiKeys: { revealKey: mocks.revealKey } });
    mocks.revealKey.mockResolvedValue(null);

    const res = await GET(request("tok"), { params: paramsFor("s_404") });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { message: "API key not found", type: "OAuthException", code: 400 },
    });
    expect(mocks.revealKey).toHaveBeenCalledWith("s_404");
  });

  it("returns 409 when the key is revoked", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({ apiKeys: { revealKey: mocks.revealKey } });
    mocks.revealKey.mockRejectedValue(new ApiKeyRevokedError());

    const res = await GET(request("tok"), { params: paramsFor("s_409") });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { message: "API key is revoked", type: "OAuthException", code: 409 },
    });
  });

  it("returns 410 for a pre-ciphertext key and emits an audit line", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({ apiKeys: { revealKey: mocks.revealKey } });
    mocks.revealKey.mockRejectedValue(new KeySecretNotRecoverableError());

    const res = await GET(request("tok"), { params: paramsFor("s_410") });

    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({
      error: { message: "secret is not recoverable for this key", type: "OAuthException", code: 410 },
    });
    const audit = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(audit.event).toBe("api_key.reveal");
    expect(audit.serial).toBe("s_410");
    expect(audit.outcome).toBe("not_recoverable");
    logSpy.mockRestore();
  });

  it("returns the exact secret and emits an audit line", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({ apiKeys: { revealKey: mocks.revealKey } });
    mocks.revealKey.mockResolvedValue({ secret: "waba_dev_abc123" });

    const res = await GET(request("tok"), { params: paramsFor("s_200") });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ secret: "waba_dev_abc123" });
    const audit = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(audit.outcome).toBe("revealed");
    logSpy.mockRestore();
  });

  it("returns a generic 500 and leaks nothing on decryption failure", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({ apiKeys: { revealKey: mocks.revealKey } });
    mocks.revealKey.mockRejectedValue(
      new KeySecretDecryptionError(
        new Error("gcm: auth tag mismatch for key s_500"),
      ),
    );

    const res = await GET(request("tok"), { params: paramsFor("s_500") });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({
      error: { message: "Unable to reveal API key", type: "OAuthException", code: 500 },
    });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("auth tag mismatch");
    expect(raw).not.toContain("v1.");
  });

  it("rate-limits per serial (429 after 10 within the window)", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({ apiKeys: { revealKey: mocks.revealKey } });
    mocks.revealKey.mockResolvedValue({ secret: "waba_dev_rate_limited" });

    const serial = "s_ratelimited";
    let lastStatus = 0;
    for (let i = 0; i < 11; i += 1) {
      const res = await GET(request("tok"), { params: paramsFor(serial) });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
    expect(await (await GET(request("tok"), { params: paramsFor(serial) })).json()).toEqual({
      error: { message: "Too many requests", type: "OAuthException", code: 429 },
    });
  });
});
