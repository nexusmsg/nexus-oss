import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  basicAuthHeader,
  cacheAuthHeader,
  clearAuthHeader,
  getBearerToken,
  getCachedAuthHeader,
  promptForBasicAuth,
  resolveAuthHeader,
} from "./auth";

describe("getBearerToken", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the token when NEXT_PUBLIC_API_TOKEN is set", () => {
    vi.stubEnv("NEXT_PUBLIC_API_TOKEN", "secret-token");
    expect(getBearerToken()).toBe("secret-token");
  });

  it("trims surrounding whitespace", () => {
    vi.stubEnv("NEXT_PUBLIC_API_TOKEN", "  secret-token  ");
    expect(getBearerToken()).toBe("secret-token");
  });

  it("treats a blank token as unset (Basic mode)", () => {
    vi.stubEnv("NEXT_PUBLIC_API_TOKEN", "   ");
    expect(getBearerToken()).toBeUndefined();
  });

  it("is undefined when the env var is absent", () => {
    vi.stubEnv("NEXT_PUBLIC_API_TOKEN", undefined);
    expect(getBearerToken()).toBeUndefined();
  });
});

describe("resolveAuthHeader", () => {
  beforeEach(() => {
    clearAuthHeader();
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    clearAuthHeader();
    vi.unstubAllEnvs();
  });

  it("prefers the Bearer token over a cached Basic header", () => {
    vi.stubEnv("NEXT_PUBLIC_API_TOKEN", "bearer-token");
    cacheAuthHeader("Basic Zm9vOmJhcg==");
    expect(resolveAuthHeader()).toBe("Bearer bearer-token");
  });

  it("falls back to the cached Basic header when no token is set", () => {
    cacheAuthHeader("Basic Zm9vOmJhcg==");
    expect(resolveAuthHeader()).toBe("Basic Zm9vOmJhcg==");
  });

  it("returns null when no credentials are configured", () => {
    expect(resolveAuthHeader()).toBeNull();
  });
});

describe("basicAuthHeader / sessionStorage cache", () => {
  beforeEach(() => {
    clearAuthHeader();
  });
  afterEach(() => {
    clearAuthHeader();
  });

  it("builds a Basic header from username:password", () => {
    expect(basicAuthHeader("tok-123")).toBe(`Basic ${btoa("nexus:tok-123")}`);
    expect(basicAuthHeader("tok-123", "admin")).toBe(`Basic ${btoa("admin:tok-123")}`);
  });

  it("round-trips through sessionStorage and clears", () => {
    expect(getCachedAuthHeader()).toBeNull();
    cacheAuthHeader("Basic Zm9vOmJhcg==");
    expect(getCachedAuthHeader()).toBe("Basic Zm9vOmJhcg==");
    clearAuthHeader();
    expect(getCachedAuthHeader()).toBeNull();
  });
});

describe("promptForBasicAuth", () => {
  beforeEach(() => {
    clearAuthHeader();
  });
  afterEach(() => {
    clearAuthHeader();
    vi.restoreAllMocks();
  });

  it("prompts for the token, caches a Basic header, and returns it", () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("  tok-123  ");
    const header = promptForBasicAuth();
    expect(promptSpy).toHaveBeenCalled();
    expect(header).toBe(`Basic ${btoa("nexus:tok-123")}`);
    expect(getCachedAuthHeader()).toBe(header);
  });

  it("returns null and caches nothing when the user cancels", () => {
    vi.spyOn(window, "prompt").mockReturnValue(null);
    expect(promptForBasicAuth()).toBeNull();
    expect(getCachedAuthHeader()).toBeNull();
  });

  it("returns null for a blank entry", () => {
    vi.spyOn(window, "prompt").mockReturnValue("   ");
    expect(promptForBasicAuth()).toBeNull();
    expect(getCachedAuthHeader()).toBeNull();
  });
});
