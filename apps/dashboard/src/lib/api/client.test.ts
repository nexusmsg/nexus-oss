import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { clearAuthHeader } from "./auth";
import { apiGet, apiPost, getApiBaseUrl, normalizeApiError } from "./client";
import { ApiError } from "./types";

/** Minimal Response-like object so tests don't depend on the fetch globals. */
function jsonResponse(body: unknown, status = 200, statusText = "OK"): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: new Headers({ "Content-Type": "application/json" }),
    async text() {
      return JSON.stringify(body);
    },
    async json() {
      return body;
    },
  } as unknown as Response;
}

function mockFetch(...responses: Response[]): Mock {
  const mock = vi.fn();
  responses.forEach((res) => mock.mockResolvedValueOnce(res));
  if (responses.length === 0) mock.mockResolvedValue(jsonResponse({}));
  return mock;
}

describe("normalizeApiError", () => {
  it("maps the WABA error envelope { error: { message, type, code } }", () => {
    const err = normalizeApiError(
      400,
      { error: { message: "number is required", type: "OAuthException", code: 100 } },
      "fallback",
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.code).toBe(100);
    expect(err.message).toBe("number is required");
    expect(err.details).toBeNull();
    expect(err.isAuthError).toBe(false);
  });

  it("maps the { error: { code, details } } variant and flags auth errors", () => {
    const err = normalizeApiError(
      401,
      { error: { code: 190, details: "Invalid OAuth access token" } },
      "fallback",
    );
    expect(err.code).toBe(190);
    expect(err.message).toBe("Invalid OAuth access token");
    expect(err.details).toBe("Invalid OAuth access token");
    expect(err.isAuthError).toBe(true);
  });

  it("flags status 401 as an auth error even without an envelope", () => {
    const err = normalizeApiError(401, { nope: true }, "fallback");
    expect(err.message).toBe("fallback");
    expect(err.isAuthError).toBe(true);
  });

  it("falls back when the body is not a WABA envelope", () => {
    const err = normalizeApiError(500, "boom", "Server exploded");
    expect(err.message).toBe("Server exploded");
    expect(err.code).toBeNull();
  });

  it("falls back when the envelope error is not an object", () => {
    const err = normalizeApiError(500, { error: "nope" }, "fallback");
    expect(err.message).toBe("fallback");
  });
});

describe("api client", () => {
  beforeEach(() => {
    clearAuthHeader();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:3000");
  });
  afterEach(() => {
    clearAuthHeader();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("builds the base URL from NEXT_PUBLIC_API_URL", () => {
    expect(getApiBaseUrl()).toBe("http://localhost:3000");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:3000/");
    expect(getApiBaseUrl()).toBe("http://localhost:3000");
  });

  it("GETs JSON from the configured base URL", async () => {
    const fetchMock = mockFetch(jsonResponse({ sessions: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiGet<{ sessions: unknown[] }>("/api/v1/sessions")).resolves.toEqual({
      sessions: [],
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/v1/sessions");
    expect(init.method).toBe("GET");
  });

  it("POSTs a JSON body with the Authorization header", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_TOKEN", "bearer-tok");
    const fetchMock = mockFetch(jsonResponse({ id: "ses_1" }, 201));
    vi.stubGlobal("fetch", fetchMock);

    await apiPost("/api/v1/sessions", { phone_number_id: "123", number: "+1555" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      phone_number_id: "123",
      number: "+1555",
    });
    expect(init.headers).toBeInstanceOf(Headers);
    expect((init.headers as Headers).get("Authorization")).toBe("Bearer bearer-tok");
    expect((init.headers as Headers).get("Content-Type")).toBe("application/json");
  });

  it("throws a normalized ApiError for WABA error envelopes", async () => {
    // Mock the Basic prompt so jsdom doesn't emit "Not implemented" noise.
    vi.spyOn(window, "prompt").mockReturnValue(null);
    const fetchMock = mockFetch(
      jsonResponse({ error: { message: "Invalid OAuth access token", code: 190 } }, 401, "Unauthorized"),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiGet("/api/v1/sessions")).rejects.toMatchObject({
      status: 401,
      code: 190,
      isAuthError: true,
    });
  });

  it("prompts for Basic auth on 401 (no bearer token) and retries once", async () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("tok-123");
    const fetchMock = mockFetch(
      jsonResponse({ error: { code: 190, message: "Invalid OAuth access token" } }, 401, "Unauthorized"),
      jsonResponse({ sessions: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiGet<{ sessions: unknown[] }>("/api/v1/sessions")).resolves.toEqual({
      sessions: [],
    });

    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, firstInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect((firstInit.headers as Headers).get("Authorization")).toBeNull();
    expect((secondInit.headers as Headers).get("Authorization")).toBe(
      `Basic ${btoa("nexus:tok-123")}`,
    );
  });

  it("does not prompt when a bearer token is configured (Basic mode disabled)", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_TOKEN", "bearer-tok");
    const promptSpy = vi.spyOn(window, "prompt");
    const fetchMock = mockFetch(
      jsonResponse({ error: { code: 190, message: "Invalid OAuth access token" } }, 401, "Unauthorized"),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiGet("/api/v1/sessions")).rejects.toBeInstanceOf(ApiError);
    expect(promptSpy).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws the 401 when the user cancels the Basic prompt", async () => {
    vi.spyOn(window, "prompt").mockReturnValue(null);
    const fetchMock = mockFetch(
      jsonResponse({ error: { code: 190, message: "Invalid OAuth access token" } }, 401, "Unauthorized"),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiGet("/api/v1/sessions")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
