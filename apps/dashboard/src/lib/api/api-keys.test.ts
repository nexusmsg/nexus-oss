/**
 * Client tests for the `/api/v1/api-keys*` typed functions. Verifies request
 * paths, methods, snake_case payloads, the `{ api_keys }` list envelope, and
 * the one-time plaintext secret contract of `createApiKey`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { clearAuthHeader } from "./auth";
import {
  createApiKey,
  getApiKey,
  listApiKeys,
  revokeApiKey,
  updateApiKey,
} from "./api-keys";
import type { ApiKey } from "./types";

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

function makeApiKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    serial: "key_1",
    name: "CI deploy",
    key_prefix: "waba_dev_",
    scope: "full",
    status: "active",
    expires_at: null,
    last_used_at: null,
    created_at: "2026-08-12T00:00:00.000Z",
    updated_at: "2026-08-12T00:00:00.000Z",
    ...overrides,
  };
}

describe("api-key client functions", () => {
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

  it("listApiKeys GETs /api/v1/api-keys and maps the { api_keys } envelope", async () => {
    const keys = [makeApiKey(), makeApiKey({ serial: "key_2", status: "revoked" })];
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ api_keys: keys }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listApiKeys()).resolves.toEqual(keys);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/api-keys");
    expect(init.method).toBe("GET");
  });

  it("createApiKey POSTs the snake_case payload and returns the one-time secret", async () => {
    const created = {
      key: makeApiKey(),
      secret: "waba_dev_0123456789abcdef0123456789abcdef",
    };
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(created, 201));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createApiKey({
        name: "CI deploy",
        scope: "full",
        expires_at: "2027-01-01T00:00:00.000Z",
      }),
    ).resolves.toEqual(created);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/api-keys");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      name: "CI deploy",
      scope: "full",
      expires_at: "2027-01-01T00:00:00.000Z",
    });
  });

  it("createApiKey sends expires_at null as-is (never expires)", async () => {
    fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ key: makeApiKey(), secret: "waba_dev_s" }, 201));
    vi.stubGlobal("fetch", fetchMock);

    await createApiKey({ name: "x", scope: "read", expires_at: null });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      name: "x",
      scope: "read",
      expires_at: null,
    });
  });

  it("getApiKey GETs the key by serial", async () => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(makeApiKey()));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getApiKey("key_1")).resolves.toEqual(makeApiKey());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/api-keys/key_1");
    expect(init.method).toBe("GET");
  });

  it("updateApiKey PATCHes the snake_case body and returns the updated key", async () => {
    const updated = makeApiKey({ name: "renamed", scope: "read" });
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(updated));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      updateApiKey("key_1", { name: "renamed", scope: "read" }),
    ).resolves.toEqual(updated);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/api-keys/key_1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ name: "renamed", scope: "read" });
  });

  it("revokeApiKey DELETEs the key by serial", async () => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(revokeApiKey("key_1")).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/api-keys/key_1");
    expect(init.method).toBe("DELETE");
  });

  it("encodes serials in the URL", async () => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(makeApiKey()));
    vi.stubGlobal("fetch", fetchMock);

    await getApiKey("a/b c");
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("/api/v1/api-keys/a%2Fb%20c");
  });

  it("surfaces the WABA error envelope as a normalized ApiError", async () => {
    fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        { error: { message: "Invalid OAuth access token", type: "OAuthException", code: 401 } },
        401,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(listApiKeys()).rejects.toMatchObject({
      status: 401,
      code: 401,
      message: "Invalid OAuth access token",
      isAuthError: true,
    });
  });
});
