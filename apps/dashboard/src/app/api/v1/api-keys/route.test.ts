/**
 * Route tests for GET/POST /api/v1/api-keys. Composition and config are
 * mocked so the handler's auth, WABA error-envelope, redaction, and JSON
 * mapping behavior can be asserted without a database.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ValidationError } from "@/lib/api/domain/errors";
import type { RedactedApiKey } from "@/lib/api/service/api-key-management";
import { GET, POST } from "./route";

const mocks = vi.hoisted(() => ({
  composeServices: vi.fn(),
  loadConfig: vi.fn(),
  listKeys: vi.fn(),
  createKey: vi.fn(),
}));

vi.mock("@/lib/api/compose", () => ({
  composeServices: mocks.composeServices,
}));
vi.mock("@/lib/api/config", () => ({
  loadConfig: mocks.loadConfig,
}));

function request(method: "GET" | "POST", token: string, body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/api-keys", {
    method,
    headers: token === "" ? {} : { Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function redactedKey(overrides: Partial<RedactedApiKey> = {}): RedactedApiKey {
  return {
    serial: "key_1",
    name: "CI deploy",
    keyPrefix: "waba_dev_",
    scope: "full",
    status: "active",
    expiresAt: null,
    lastUsedAt: null,
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
    ...overrides,
  };
}

describe("GET /api/v1/api-keys", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 with the WABA envelope when auth is missing or wrong", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });

    const unauthorized = await GET(request("GET", ""));
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({
      error: { message: "Invalid OAuth access token", type: "OAuthException", code: 401 },
    });
    expect(mocks.composeServices).not.toHaveBeenCalled();

    const wrongToken = await GET(request("GET", "wrong"));
    expect(wrongToken.status).toBe(401);
  });

  it("returns redacted keys under api_keys, never the secret", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({ apiKeys: { listKeys: mocks.listKeys } });
    mocks.listKeys.mockResolvedValue([
      redactedKey(),
      redactedKey({ serial: "key_2", scope: "read", status: "revoked" }),
    ]);

    const res = await GET(request("GET", "tok"));

    expect(res.status).toBe(200);
    expect(mocks.listKeys).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual({
      api_keys: [
        {
          serial: "key_1",
          name: "CI deploy",
          key_prefix: "waba_dev_",
          scope: "full",
          status: "active",
          expires_at: null,
          last_used_at: null,
          created_at: "2026-08-12T00:00:00.000Z",
          updated_at: "2026-08-12T00:00:00.000Z",
        },
        {
          serial: "key_2",
          name: "CI deploy",
          key_prefix: "waba_dev_",
          scope: "read",
          status: "revoked",
          expires_at: null,
          last_used_at: null,
          created_at: "2026-08-12T00:00:00.000Z",
          updated_at: "2026-08-12T00:00:00.000Z",
        },
      ],
    });
  });
});

describe("POST /api/v1/api-keys", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 with the WABA envelope when auth is missing or wrong", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });

    const unauthorized = await POST(request("POST", ""));
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({
      error: { message: "Invalid OAuth access token", type: "OAuthException", code: 401 },
    });
    expect(mocks.composeServices).not.toHaveBeenCalled();
  });

  it("returns 400 with the WABA envelope for an unparseable body", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    const req = new NextRequest("http://localhost/api/v1/api-keys", {
      method: "POST",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: "{not json",
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { message: "Invalid request body", type: "OAuthException", code: 400 },
    });
  });

  it("returns 400 with the WABA envelope for validation errors", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({ apiKeys: { createKey: mocks.createKey } });
    mocks.createKey.mockRejectedValue(new ValidationError("name is required"));

    const res = await POST(request("POST", "tok", { name: "", scope: "read" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { message: "name is required", type: "OAuthException", code: 400 },
    });
  });

  it("rejects an invalid or missing scope before calling the service", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({ apiKeys: { createKey: mocks.createKey } });

    const res = await POST(request("POST", "tok", { name: "x", scope: "admin" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        message: "scope must be one of: read, write, full",
        type: "OAuthException",
        code: 400,
      },
    });
    expect(mocks.createKey).not.toHaveBeenCalled();
  });

  it("returns the redacted key plus the one-time plaintext secret on create (201)", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({ apiKeys: { createKey: mocks.createKey } });
    mocks.createKey.mockResolvedValue({
      key: redactedKey(),
      secret: "waba_dev_0123456789abcdef",
    });

    const res = await POST(
      request("POST", "tok", {
        name: "CI deploy",
        scope: "full",
        expires_at: "2027-01-01T00:00:00.000Z",
      }),
    );

    expect(res.status).toBe(201);
    expect(mocks.createKey).toHaveBeenCalledWith({
      name: "CI deploy",
      scope: "full",
      expiresAt: "2027-01-01T00:00:00.000Z",
    });
    expect(await res.json()).toEqual({
      key: {
        serial: "key_1",
        name: "CI deploy",
        key_prefix: "waba_dev_",
        scope: "full",
        status: "active",
        expires_at: null,
        last_used_at: null,
        created_at: "2026-08-12T00:00:00.000Z",
        updated_at: "2026-08-12T00:00:00.000Z",
      },
      secret: "waba_dev_0123456789abcdef",
    });
  });

  it("maps an omitted expires_at to undefined (never expires)", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({ apiKeys: { createKey: mocks.createKey } });
    mocks.createKey.mockResolvedValue({ key: redactedKey(), secret: "waba_dev_s" });

    await POST(request("POST", "tok", { name: "x", scope: "write" }));

    expect(mocks.createKey).toHaveBeenCalledWith({
      name: "x",
      scope: "write",
      expiresAt: undefined,
    });
  });
});
