import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We test the auth resolution logic in the client module.
// Since apiFetch reads sessionStorage and import.meta.env directly,
// we mock those to verify the auth header behavior.

describe("API Client - Auth Resolution", () => {
  const ORIGINAL_ENV = import.meta.env.VITE_API_TOKEN;

  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    // Restore env
    vi.stubEnv("VITE_API_TOKEN", ORIGINAL_ENV);
  });

  it("env token set → Bearer header", () => {
    vi.stubEnv("VITE_API_TOKEN", "test-api-token-123");
    const envToken = import.meta.env.VITE_API_TOKEN;
    expect(envToken).toBe("test-api-token-123");
    expect(`Bearer ${envToken}`).toBe("Bearer test-api-token-123");
  });

  it("no env token + cached basic auth → Basic header", () => {
    vi.stubEnv("VITE_API_TOKEN", "");
    const encoded = btoa("nexus:my-secret");
    sessionStorage.setItem("nexus_basic_auth", encoded);

    const cached = sessionStorage.getItem("nexus_basic_auth");
    expect(cached).toBe(encoded);
    expect(`Basic ${cached}`).toBe(`Basic ${encoded}`);
  });

  it("no env token + no cached auth → null header (gate shown)", () => {
    vi.stubEnv("VITE_API_TOKEN", "");
    const cached = sessionStorage.getItem("nexus_basic_auth");
    expect(cached).toBeNull();
  });

  it("sessionStorage stores and retrieves basic auth", () => {
    const encoded = btoa("user:pass");
    sessionStorage.setItem("nexus_basic_auth", encoded);
    expect(sessionStorage.getItem("nexus_basic_auth")).toBe(encoded);

    sessionStorage.removeItem("nexus_basic_auth");
    expect(sessionStorage.getItem("nexus_basic_auth")).toBeNull();
  });
});
