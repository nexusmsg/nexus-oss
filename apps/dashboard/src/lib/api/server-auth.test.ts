/**
 * Unit tests for the server-side authorizers (API-5a).
 *
 * Covers the constant-time comparator, the async public authorizer's bootstrap
 * `API_AUTH_TOKEN` parity and empty-token closure, and the strict
 * `INTERNAL_TOKEN` isolation of `authorizeInternal` (bootstrap and persisted
 * credentials are never accepted there).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  authorizeApi,
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

describe("authorizeApi (async public authorizer)", () => {
  it("accepts a matching bootstrap token", async () => {
    await expect(authorizeApi(bearerReq("tok"), "tok")).resolves.toBe(true);
  });

  it("accepts long bootstrap tokens of any length", async () => {
    await expect(
      authorizeApi(bearerReq("bootstrap-token-0123456789"), "bootstrap-token-0123456789"),
    ).resolves.toBe(true);
  });

  it("rejects a missing Authorization header", async () => {
    await expect(authorizeApi(bearerReq(null), "tok")).resolves.toBe(false);
  });

  it("rejects a wrong token", async () => {
    await expect(authorizeApi(bearerReq("wrong"), "tok")).resolves.toBe(false);
  });

  it("rejects a token that only shares a prefix", async () => {
    await expect(authorizeApi(bearerReq("tok"), "tok-extra")).resolves.toBe(false);
    await expect(authorizeApi(bearerReq("tok-extra"), "tok")).resolves.toBe(false);
  });

  it("rejects a non-Bearer scheme", async () => {
    await expect(authorizeApi(basicReq(), "tok")).resolves.toBe(false);
  });

  it("closes public routes when the configured token is empty, even with a Bearer header", async () => {
    await expect(authorizeApi(bearerReq("anything"), "")).resolves.toBe(false);
    await expect(authorizeApi(bearerReq(""), "")).resolves.toBe(false);
    await expect(authorizeApi(bearerReq(null), "")).resolves.toBe(false);
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
    expect(
      authorizeInternal(bearerReq("waba_dev_0123456789abcdef0123456789abcdef")),
    ).toBe(false);
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
