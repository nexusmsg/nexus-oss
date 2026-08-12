/**
 * Route tests for GET/PATCH/DELETE /api/v1/api-keys/[serial]. Composition and
 * config are mocked so the handler's auth, WABA error-envelope, 404, and
 * redaction behavior can be asserted without a database.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ValidationError } from "@/lib/api/domain/errors";
import type { RedactedApiKey } from "@/lib/api/service/api-key-management";
import { DELETE, GET, PATCH } from "./route";

const mocks = vi.hoisted(() => ({
  composeServices: vi.fn(),
  loadConfig: vi.fn(),
  getKey: vi.fn(),
  updateKey: vi.fn(),
  revokeKey: vi.fn(),
}));

vi.mock("@/lib/api/compose", () => ({
  composeServices: mocks.composeServices,
}));
vi.mock("@/lib/api/config", () => ({
  loadConfig: mocks.loadConfig,
}));

function request(method: "GET" | "PATCH" | "DELETE", token: string, body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/api-keys/key_1", {
    method,
    headers: token === "" ? {} : { Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const params = Promise.resolve({ serial: "key_1" });

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

describe("GET /api/v1/api-keys/[serial]", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 with the WABA envelope when auth is missing or wrong", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });

    const unauthorized = await GET(request("GET", ""), { params });
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({
      error: { message: "Invalid OAuth access token", type: "OAuthException", code: 401 },
    });
    expect(mocks.composeServices).not.toHaveBeenCalled();
  });

  it("returns 404 with the WABA envelope when the key is absent", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({ apiKeys: { getKey: mocks.getKey } });
    mocks.getKey.mockResolvedValue(null);

    const res = await GET(request("GET", "tok"), { params });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { message: "API key not found", type: "OAuthException", code: 400 },
    });
    expect(mocks.getKey).toHaveBeenCalledWith("key_1");
  });

  it("returns a redacted key, never the secret", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({ apiKeys: { getKey: mocks.getKey } });
    mocks.getKey.mockResolvedValue(redactedKey({ expiresAt: "2027-01-01T00:00:00.000Z" }));

    const res = await GET(request("GET", "tok"), { params });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      serial: "key_1",
      name: "CI deploy",
      key_prefix: "waba_dev_",
      scope: "full",
      status: "active",
      expires_at: "2027-01-01T00:00:00.000Z",
      last_used_at: null,
      created_at: "2026-08-12T00:00:00.000Z",
      updated_at: "2026-08-12T00:00:00.000Z",
    });
  });
});

describe("PATCH /api/v1/api-keys/[serial]", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 with the WABA envelope when auth is missing or wrong", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });

    const unauthorized = await PATCH(request("PATCH", ""), { params });
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({
      error: { message: "Invalid OAuth access token", type: "OAuthException", code: 401 },
    });
    expect(mocks.composeServices).not.toHaveBeenCalled();
  });

  it("returns 400 with the WABA envelope for an unparseable body", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    const req = new NextRequest("http://localhost/api/v1/api-keys/key_1", {
      method: "PATCH",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: "{not json",
    });

    const res = await PATCH(req, { params });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { message: "Invalid request body", type: "OAuthException", code: 400 },
    });
  });

  it("returns 404 with the WABA envelope when the key is absent", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({ apiKeys: { updateKey: mocks.updateKey } });
    mocks.updateKey.mockResolvedValue(null);

    const res = await PATCH(request("PATCH", "tok", { name: "renamed" }), { params });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { message: "API key not found", type: "OAuthException", code: 400 },
    });
    expect(mocks.updateKey).toHaveBeenCalledWith("key_1", { name: "renamed" });
  });

  it("returns 400 with the WABA envelope for validation errors", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({ apiKeys: { updateKey: mocks.updateKey } });
    mocks.updateKey.mockRejectedValue(new ValidationError("name is required"));

    const res = await PATCH(request("PATCH", "tok", { name: " " }), { params });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { message: "name is required", type: "OAuthException", code: 400 },
    });
  });

  it("maps snake_case body fields to the service input and returns the updated key", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({ apiKeys: { updateKey: mocks.updateKey } });
    mocks.updateKey.mockResolvedValue(redactedKey({ name: "renamed", scope: "read" }));

    const res = await PATCH(
      request("PATCH", "tok", { name: "renamed", scope: "read", expires_at: null }),
      { params },
    );

    expect(mocks.updateKey).toHaveBeenCalledWith("key_1", {
      name: "renamed",
      scope: "read",
      expiresAt: null,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      serial: "key_1",
      name: "renamed",
      key_prefix: "waba_dev_",
      scope: "read",
      status: "active",
      expires_at: null,
      last_used_at: null,
      created_at: "2026-08-12T00:00:00.000Z",
      updated_at: "2026-08-12T00:00:00.000Z",
    });
  });
});

describe("DELETE /api/v1/api-keys/[serial]", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 with the WABA envelope when auth is missing or wrong", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });

    const unauthorized = await DELETE(request("DELETE", ""), { params });
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({
      error: { message: "Invalid OAuth access token", type: "OAuthException", code: 401 },
    });
    expect(mocks.composeServices).not.toHaveBeenCalled();
  });

  it("returns 404 with the WABA envelope when the key is absent", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({ apiKeys: { revokeKey: mocks.revokeKey } });
    mocks.revokeKey.mockResolvedValue(null);

    const res = await DELETE(request("DELETE", "tok"), { params });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { message: "API key not found", type: "OAuthException", code: 400 },
    });
    expect(mocks.revokeKey).toHaveBeenCalledWith("key_1");
  });

  it("revokes the key and returns { ok: true }", async () => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue({ apiKeys: { revokeKey: mocks.revokeKey } });
    mocks.revokeKey.mockResolvedValue(redactedKey({ status: "revoked" }));

    const res = await DELETE(request("DELETE", "tok"), { params });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
