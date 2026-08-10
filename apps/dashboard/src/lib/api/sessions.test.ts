import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { clearAuthHeader } from "./auth";
import {
  createSession,
  getPairingQr,
  getSessionStatus,
  listSessions,
  logout,
  requestPairing,
} from "./sessions";
import type { Session } from "./types";

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

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "ses_1",
    phone_number_id: "123",
    number: "+15550001000",
    display_phone: null,
    business_account_id: null,
    status: "created",
    whatsapp_id: null,
    connected_at: null,
    last_seen_at: null,
    logged_out_at: null,
    created_at: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

describe("session api functions", () => {
  let fetchMock: Mock;

  beforeEach(() => {
    clearAuthHeader();
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:3000");
  });
  afterEach(() => {
    clearAuthHeader();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("listSessions hits GET /sessions and maps the { sessions } envelope", async () => {
    const sessions = [makeSession(), makeSession({ id: "ses_2" })];
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ sessions }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listSessions()).resolves.toEqual(sessions);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/v1/sessions");
    expect(init.method).toBe("GET");
  });

  it("createSession POSTs the payload and returns the created session", async () => {
    const created = makeSession({ status: "created" });
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(created, 201));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createSession({ phone_number_id: "123", number: "+15550001000", display_phone: "Work" }),
    ).resolves.toEqual(created);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/v1/sessions");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      phone_number_id: "123",
      number: "+15550001000",
      display_phone: "Work",
    });
  });

  it("requestPairing POSTs to the pairing route", async () => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ job_serial: "job_1" }, 202));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestPairing("ses_1")).resolves.toEqual({ job_serial: "job_1" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/v1/sessions/ses_1/pairing");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });

  it("logout POSTs to the logout route", async () => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ job_serial: "job_2" }, 202));
    vi.stubGlobal("fetch", fetchMock);

    await expect(logout("ses_1")).resolves.toEqual({ job_serial: "job_2" });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://localhost:3000/api/v1/sessions/ses_1/logout");
  });

  it("getPairingQr GETs the QR endpoint and returns the raw envelope", async () => {
    fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ status: "not_found", qr_code: null }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getPairingQr("ses_1")).resolves.toEqual({
      status: "not_found",
      qr_code: null,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/v1/sessions/ses_1/pairing/qr");
    expect(init.method).toBe("GET");
  });

  it("getSessionStatus returns just the status string", async () => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "connected" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getSessionStatus("ses_1")).resolves.toBe("connected");
  });

  it("encodes serials in the URL", async () => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "ready", qr_code: "x" }));
    vi.stubGlobal("fetch", fetchMock);

    await getPairingQr("a/b c");
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://localhost:3000/api/v1/sessions/a%2Fb%20c/pairing/qr");
  });
});
