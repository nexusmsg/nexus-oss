/**
 * Unit tests for the server-side authorizers (API-5a + API-5b).
 *
 * API-5a coverage: the constant-time comparator, bootstrap `API_AUTH_TOKEN`
 * parity, empty-token closure, and strict `INTERNAL_TOKEN` isolation of
 * `authorizeInternal`.
 *
 * API-5b coverage: persisted-key acceptance via SHA-256 hash lookup, rejection
 * of unknown/revoked/expired/soft-deleted keys, the read/write/full scope
 * matrix, bootstrap-only management mode, empty-token closure over persisted
 * keys, the `waba_` prefix fast-path, and the throttled best-effort
 * `last_used_at` touch (never on failure, never rejecting unhandled).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Mock } from "vitest";
import type { ApiKey } from "./domain/api-key";
import { hashApiKeySecret } from "./service/api-key-management";
import {
  authorizeApi,
  authorizeApiWithIdentity,
  authorizeInternal,
  bearerToken,
  safeEqual,
} from "./server-auth";

function bearerReq(token: string | null): NextRequest {
  return new NextRequest("http://localhost/api/v1/test", {
    headers: token === null ? {} : { Authorization: `Bearer ${token}` },
  });
}

function basicReq(): NextRequest {
  return new NextRequest("http://localhost/api/v1/test", {
    headers: { Authorization: "Basic dXNlcjpwYXNz" },
  });
}

/** A persisted-key-shaped credential (matches the `waba_` fast-path prefix). */
const KEY_CREDENTIAL = "waba_dev_0123456789abcdef0123456789abcdef";

function makeKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    serial: "key_1",
    name: "test key",
    keyPrefix: "waba_dev_",
    keyHash: hashApiKeySecret(KEY_CREDENTIAL),
    keyCiphertext: null,
    scope: "read",
    status: "active",
    expiresAt: null,
    lastUsedAt: null,
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

/** Build an auth port whose lookup resolves to `key` (or rejects with `error`). */
function authPort(key: ApiKey | null, touch: Mock = vi.fn(async () => undefined)) {
  return {
    getKeyByHash: vi.fn(async () => key),
    touchKeyLastUsed: touch,
  };
}

describe("safeEqual (constant-time comparator)", () => {
  it("returns true for identical strings", () => {
    expect(safeEqual("secret-token", "secret-token")).toBe(true);
  });

  it("returns false for different strings of equal length", () => {
    expect(safeEqual("secret-token", "secret-tokef")).toBe(false);
  });

  it("returns false for strings of different lengths", () => {
    expect(safeEqual("a", "a-much-longer-token")).toBe(false);
    expect(safeEqual("a-much-longer-token", "a")).toBe(false);
  });

  it("returns false when only one side is empty", () => {
    expect(safeEqual("", "token")).toBe(false);
    expect(safeEqual("token", "")).toBe(false);
  });

  it("returns true for two empty strings (callers guard empties)", () => {
    expect(safeEqual("", "")).toBe(true);
  });
});

describe("bearerToken", () => {
  it("extracts the credential from a Bearer header", () => {
    expect(bearerToken(bearerReq("tok-123"))).toBe("tok-123");
  });

  it("returns null for a bare `Bearer ` header (Headers trims trailing space)", () => {
    // Node's Headers normalizes "Bearer " to "Bearer", so no credential is
    // extracted; the old `authorizeBearer` behaved identically.
    expect(bearerToken(bearerReq(""))).toBeNull();
  });

  it("returns null without an Authorization header", () => {
    expect(bearerToken(bearerReq(null))).toBeNull();
  });

  it("returns null for a non-Bearer scheme", () => {
    expect(bearerToken(basicReq())).toBeNull();
  });
});

describe("authorizeApi (async public authorizer, API-5a bootstrap parity)", () => {
  it("accepts a matching bootstrap token regardless of the required scope", async () => {
    await expect(
      authorizeApi(bearerReq("tok"), "tok", { requiredScope: "read" }),
    ).resolves.toBe(true);
    await expect(
      authorizeApi(bearerReq("tok"), "tok", { requiredScope: "write" }),
    ).resolves.toBe(true);
  });

  it("accepts long bootstrap tokens of any length", async () => {
    await expect(
      authorizeApi(
        bearerReq("bootstrap-token-0123456789"),
        "bootstrap-token-0123456789",
        { requiredScope: "read" },
      ),
    ).resolves.toBe(true);
  });

  it("does not consult persisted keys when the bootstrap token matches", async () => {
    const getPersistedKeys = vi.fn(() => authPort(makeKey()));
    await expect(
      authorizeApi(bearerReq("tok"), "tok", {
        requiredScope: "read",
        getPersistedKeys,
      }),
    ).resolves.toBe(true);
    expect(getPersistedKeys).not.toHaveBeenCalled();
  });

  it("rejects a missing Authorization header", async () => {
    await expect(
      authorizeApi(bearerReq(null), "tok", { requiredScope: "read" }),
    ).resolves.toBe(false);
  });

  it("rejects a wrong token", async () => {
    await expect(
      authorizeApi(bearerReq("wrong"), "tok", { requiredScope: "read" }),
    ).resolves.toBe(false);
  });

  it("rejects a token that only shares a prefix", async () => {
    await expect(
      authorizeApi(bearerReq("tok"), "tok-extra", { requiredScope: "read" }),
    ).resolves.toBe(false);
    await expect(
      authorizeApi(bearerReq("tok-extra"), "tok", { requiredScope: "read" }),
    ).resolves.toBe(false);
  });

  it("rejects a non-Bearer scheme", async () => {
    await expect(
      authorizeApi(basicReq(), "tok", { requiredScope: "read" }),
    ).resolves.toBe(false);
  });

  it("closes public routes when the configured token is empty, even with a Bearer header", async () => {
    await expect(
      authorizeApi(bearerReq("anything"), "", { requiredScope: "read" }),
    ).resolves.toBe(false);
    await expect(
      authorizeApi(bearerReq(""), "", { requiredScope: "read" }),
    ).resolves.toBe(false);
    await expect(
      authorizeApi(bearerReq(null), "", { requiredScope: "read" }),
    ).resolves.toBe(false);
  });

  it("skips the persisted-key fast path for credentials that are not key-shaped", async () => {
    const getPersistedKeys = vi.fn(() => authPort(makeKey()));
    await expect(
      authorizeApi(bearerReq("wrong"), "tok", {
        requiredScope: "read",
        getPersistedKeys,
      }),
    ).resolves.toBe(false);
    expect(getPersistedKeys).not.toHaveBeenCalled();
  });
});

describe("authorizeApi persisted-key auth (API-5b)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("accepts an active read-scoped key on a read route and touches last_used_at", async () => {
    const port = authPort(makeKey({ scope: "read" }));
    await expect(
      authorizeApi(bearerReq(KEY_CREDENTIAL), "bootstrap-tok", {
        requiredScope: "read",
        getPersistedKeys: () => port,
      }),
    ).resolves.toBe(true);
    expect(port.getKeyByHash).toHaveBeenCalledWith(hashApiKeySecret(KEY_CREDENTIAL));
    expect(port.touchKeyLastUsed).toHaveBeenCalledWith("key_1");
  });

  it("accepts an active write-scoped key on a write route", async () => {
    const port = authPort(makeKey({ scope: "write" }));
    await expect(
      authorizeApi(bearerReq(KEY_CREDENTIAL), "bootstrap-tok", {
        requiredScope: "write",
        getPersistedKeys: () => port,
      }),
    ).resolves.toBe(true);
    expect(port.touchKeyLastUsed).toHaveBeenCalledWith("key_1");
  });

  it("grants both scopes to a full-scoped key", async () => {
    const port = authPort(makeKey({ scope: "full" }));
    await expect(
      authorizeApi(bearerReq(KEY_CREDENTIAL), "bootstrap-tok", {
        requiredScope: "read",
        getPersistedKeys: () => port,
      }),
    ).resolves.toBe(true);
    await expect(
      authorizeApi(bearerReq(KEY_CREDENTIAL), "bootstrap-tok", {
        requiredScope: "write",
        getPersistedKeys: () => port,
      }),
    ).resolves.toBe(true);
  });

  it("rejects a read-scoped key on a write route without touching last_used_at", async () => {
    const port = authPort(makeKey({ scope: "read" }));
    await expect(
      authorizeApi(bearerReq(KEY_CREDENTIAL), "bootstrap-tok", {
        requiredScope: "write",
        getPersistedKeys: () => port,
      }),
    ).resolves.toBe(false);
    expect(port.touchKeyLastUsed).not.toHaveBeenCalled();
  });

  it("rejects a write-scoped key on a read route", async () => {
    const port = authPort(makeKey({ scope: "write" }));
    await expect(
      authorizeApi(bearerReq(KEY_CREDENTIAL), "bootstrap-tok", {
        requiredScope: "read",
        getPersistedKeys: () => port,
      }),
    ).resolves.toBe(false);
  });

  it("rejects an unknown key (lookup resolves null)", async () => {
    const port = authPort(null);
    await expect(
      authorizeApi(bearerReq(KEY_CREDENTIAL), "bootstrap-tok", {
        requiredScope: "read",
        getPersistedKeys: () => port,
      }),
    ).resolves.toBe(false);
    expect(port.touchKeyLastUsed).not.toHaveBeenCalled();
  });

  it("rejects a revoked key", async () => {
    const port = authPort(makeKey({ status: "revoked" }));
    await expect(
      authorizeApi(bearerReq(KEY_CREDENTIAL), "bootstrap-tok", {
        requiredScope: "read",
        getPersistedKeys: () => port,
      }),
    ).resolves.toBe(false);
    expect(port.touchKeyLastUsed).not.toHaveBeenCalled();
  });

  it("rejects an expired key", async () => {
    const port = authPort(
      makeKey({ expiresAt: "2000-01-01T00:00:00.000Z" }),
    );
    await expect(
      authorizeApi(bearerReq(KEY_CREDENTIAL), "bootstrap-tok", {
        requiredScope: "read",
        getPersistedKeys: () => port,
      }),
    ).resolves.toBe(false);
    expect(port.touchKeyLastUsed).not.toHaveBeenCalled();
  });

  it("rejects a soft-deleted key (adapter resolves null, auth fails closed)", async () => {
    const port = authPort(null);
    await expect(
      authorizeApi(bearerReq(KEY_CREDENTIAL), "bootstrap-tok", {
        requiredScope: "read",
        getPersistedKeys: () => port,
      }),
    ).resolves.toBe(false);
  });

  it("rejects persisted keys when no persisted-key accessor is provided (management routes)", async () => {
    const getPersistedKeys = vi.fn(() => authPort(makeKey({ scope: "full" })));
    await expect(
      authorizeApi(bearerReq(KEY_CREDENTIAL), "bootstrap-tok", {
        requiredScope: "write",
      }),
    ).resolves.toBe(false);
    expect(getPersistedKeys).not.toHaveBeenCalled();
  });

  it("keeps public routes closed when the bootstrap token is empty, even for a valid key", async () => {
    const getPersistedKeys = vi.fn(() => authPort(makeKey()));
    await expect(
      authorizeApi(bearerReq(KEY_CREDENTIAL), "", {
        requiredScope: "read",
        getPersistedKeys,
      }),
    ).resolves.toBe(false);
    expect(getPersistedKeys).not.toHaveBeenCalled();
  });

  it("fails closed when the persisted-key accessor throws", async () => {
    await expect(
      authorizeApi(bearerReq(KEY_CREDENTIAL), "bootstrap-tok", {
        requiredScope: "read",
        getPersistedKeys: () => {
          throw new Error("boom");
        },
      }),
    ).resolves.toBe(false);
  });

  it("fails closed when the hash lookup rejects", async () => {
    const port = {
      getKeyByHash: vi.fn(async () => {
        throw new Error("db down");
      }),
      touchKeyLastUsed: vi.fn(async () => undefined),
    };
    await expect(
      authorizeApi(bearerReq(KEY_CREDENTIAL), "bootstrap-tok", {
        requiredScope: "read",
        getPersistedKeys: () => port,
      }),
    ).resolves.toBe(false);
    expect(port.touchKeyLastUsed).not.toHaveBeenCalled();
  });

  it("still authorizes when the best-effort last_used_at update rejects", async () => {
    const port = authPort(makeKey(), vi.fn(async () => {
      throw new Error("write failed");
    }));
    await expect(
      authorizeApi(bearerReq(KEY_CREDENTIAL), "bootstrap-tok", {
        requiredScope: "read",
        getPersistedKeys: () => port,
      }),
    ).resolves.toBe(true);
  });
});

describe("authorizeApi last_used_at throttling (API-5b)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("skips the touch when the key was used within the last five minutes", async () => {
    const touch = vi.fn(async () => undefined);
    const recent = new Date(Date.now() - 60_000).toISOString();
    const port = authPort(makeKey({ lastUsedAt: recent }), touch);
    await expect(
      authorizeApi(bearerReq(KEY_CREDENTIAL), "bootstrap-tok", {
        requiredScope: "read",
        getPersistedKeys: () => port,
      }),
    ).resolves.toBe(true);
    expect(touch).not.toHaveBeenCalled();
  });

  it("touches when the key was last used more than five minutes ago", async () => {
    const touch = vi.fn(async () => undefined);
    const old = new Date(Date.now() - 6 * 60_000).toISOString();
    const port = authPort(makeKey({ lastUsedAt: old }), touch);
    await expect(
      authorizeApi(bearerReq(KEY_CREDENTIAL), "bootstrap-tok", {
        requiredScope: "read",
        getPersistedKeys: () => port,
      }),
    ).resolves.toBe(true);
    expect(touch).toHaveBeenCalledWith("key_1");
  });

  it("touches when the key has never been used", async () => {
    const touch = vi.fn(async () => undefined);
    const port = authPort(makeKey({ lastUsedAt: null }), touch);
    await expect(
      authorizeApi(bearerReq(KEY_CREDENTIAL), "bootstrap-tok", {
        requiredScope: "read",
        getPersistedKeys: () => port,
      }),
    ).resolves.toBe(true);
    expect(touch).toHaveBeenCalledWith("key_1");
  });

  it("never updates last_used_at for a bootstrap credential", async () => {
    const port = authPort(makeKey());
    await expect(
      authorizeApi(bearerReq("bootstrap-tok"), "bootstrap-tok", {
        requiredScope: "read",
        getPersistedKeys: () => port,
      }),
    ).resolves.toBe(true);
    expect(port.touchKeyLastUsed).not.toHaveBeenCalled();
  });
});

describe("authorizeInternal (strict INTERNAL_TOKEN isolation)", () => {
  beforeEach(() => {
    vi.stubEnv("INTERNAL_TOKEN", "int-tok");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts the configured INTERNAL_TOKEN", () => {
    expect(authorizeInternal(bearerReq("int-tok"))).toBe(true);
  });

  it("rejects the bootstrap API_AUTH_TOKEN", () => {
    expect(authorizeInternal(bearerReq("bootstrap-tok"))).toBe(false);
  });

  it("rejects a persisted-key-shaped credential", () => {
    expect(authorizeInternal(bearerReq(KEY_CREDENTIAL))).toBe(false);
  });

  it("rejects a missing or wrong token", () => {
    expect(authorizeInternal(bearerReq(null))).toBe(false);
    expect(authorizeInternal(bearerReq("wrong"))).toBe(false);
  });

  it("is closed when INTERNAL_TOKEN is unset or empty", () => {
    vi.stubEnv("INTERNAL_TOKEN", "");
    expect(authorizeInternal(bearerReq("int-tok"))).toBe(false);
    expect(authorizeInternal(bearerReq(""))).toBe(false);
  });

  it("does not fall back to API_AUTH_TOKEN when INTERNAL_TOKEN is unset", () => {
    vi.stubEnv("INTERNAL_TOKEN", undefined);
    expect(authorizeInternal(bearerReq("bootstrap-tok"))).toBe(false);
  });
});

describe("authorizeApiWithIdentity (R1 sibling)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("resolves 'bootstrap' when the bootstrap token matches", async () => {
    await expect(
      authorizeApiWithIdentity(bearerReq("tok"), "tok", { requiredScope: "read" }),
    ).resolves.toEqual({ authorized: true, identity: "bootstrap" });
  });

  it("resolves the api key serial for an authorized persisted key", async () => {
    const port = authPort(makeKey({ serial: "key_42", scope: "read" }));
    await expect(
      authorizeApiWithIdentity(bearerReq(KEY_CREDENTIAL), "bootstrap-tok", {
        requiredScope: "read",
        getPersistedKeys: () => port,
      }),
    ).resolves.toEqual({ authorized: true, identity: "key_42" });
    expect(port.touchKeyLastUsed).toHaveBeenCalledWith("key_42");
  });

  it("resolves identity null and authorized false when unauthorized", async () => {
    const port = authPort(null);
    await expect(
      authorizeApiWithIdentity(bearerReq(KEY_CREDENTIAL), "bootstrap-tok", {
        requiredScope: "read",
        getPersistedKeys: () => port,
      }),
    ).resolves.toEqual({ authorized: false, identity: null });
  });

  it("returns identity null (not bootstrap) for a non-bearer or missing credential", async () => {
    await expect(
      authorizeApiWithIdentity(bearerReq(null), "tok", { requiredScope: "read" }),
    ).resolves.toEqual({ authorized: false, identity: null });
    await expect(
      authorizeApiWithIdentity(basicReq(), "tok", { requiredScope: "read" }),
    ).resolves.toEqual({ authorized: false, identity: null });
  });

  it("closes when the configured token is empty, with null identity", async () => {
    const port = authPort(makeKey());
    await expect(
      authorizeApiWithIdentity(bearerReq(KEY_CREDENTIAL), "", {
        requiredScope: "read",
        getPersistedKeys: () => port,
      }),
    ).resolves.toEqual({ authorized: false, identity: null });
  });

  it("rejects a wrong scope and never resolves the serial", async () => {
    const port = authPort(makeKey({ scope: "read" }));
    await expect(
      authorizeApiWithIdentity(bearerReq(KEY_CREDENTIAL), "bootstrap-tok", {
        requiredScope: "write",
        getPersistedKeys: () => port,
      }),
    ).resolves.toEqual({ authorized: false, identity: null });
    expect(port.touchKeyLastUsed).not.toHaveBeenCalled();
  });

  it("fails closed (null identity) when the persisted-key lookup rejects", async () => {
    const port = {
      getKeyByHash: vi.fn(async () => {
        throw new Error("db down");
      }),
      touchKeyLastUsed: vi.fn(async () => undefined),
    };
    await expect(
      authorizeApiWithIdentity(bearerReq(KEY_CREDENTIAL), "bootstrap-tok", {
        requiredScope: "read",
        getPersistedKeys: () => port,
      }),
    ).resolves.toEqual({ authorized: false, identity: null });
  });

  it("does not resolve a serial for bootstrap-only management routes", async () => {
    await expect(
      authorizeApiWithIdentity(bearerReq(KEY_CREDENTIAL), "bootstrap-tok", {
        requiredScope: "write",
      }),
    ).resolves.toEqual({ authorized: false, identity: null });
  });
});
