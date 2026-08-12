/**
 * Route-by-route auth regression for /api/v1/** (API-5a).
 *
 * Every public route handler is exercised through four gates:
 *  1. bootstrap auth parity — the configured `API_AUTH_TOKEN` is still honored;
 *  2. missing / wrong / non-Bearer credentials — rejected with the WABA 401
 *     envelope before any service is composed;
 *  3. empty-token closure — an empty `API_AUTH_TOKEN` closes every route;
 *  4. management routes (`/api/v1/api-keys/**`) are bootstrap-only — a
 *     persisted-key-shaped credential is rejected.
 *
 * Composition and config are mocked; no database or worker is involved.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import * as apiKeys from "./api-keys/route";
import * as apiKeySerial from "./api-keys/[serial]/route";
import * as sessions from "./sessions/route";
import * as sessionSerial from "./sessions/[serial]/route";
import * as sessionStatus from "./sessions/[serial]/status/route";
import * as sessionPairing from "./sessions/[serial]/pairing/route";
import * as sessionQr from "./sessions/[serial]/pairing/qr/route";
import * as sessionLogout from "./sessions/[serial]/logout/route";
import * as webhooks from "./webhooks/route";
import * as webhookSerial from "./webhooks/[serial]/route";
import * as subscriptions from "./webhooks/[serial]/subscriptions/route";
import * as subscriptionEvent from "./webhooks/[serial]/subscriptions/[eventType]/route";
import * as webhookTest from "./webhooks/[serial]/test/route";

const mocks = vi.hoisted(() => ({
  composeServices: vi.fn(),
  loadConfig: vi.fn(),
}));

vi.mock("@/lib/api/compose", () => ({
  composeServices: mocks.composeServices,
}));
vi.mock("@/lib/api/config", () => ({
  loadConfig: mocks.loadConfig,
}));

const UNAUTHORIZED = {
  error: { message: "Invalid OAuth access token", type: "OAuthException", code: 401 },
};

const serialParams = { params: Promise.resolve({ serial: "s_1" }) };
const eventParams = { params: Promise.resolve({ serial: "s_1", eventType: "messages" }) };

interface RouteCase {
  name: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  url: string;
  body?: unknown;
  /** Expected status on a successful bootstrap-auth path. */
  expectedStatus: number;
  call: (req: NextRequest) => Promise<Response>;
}

const routes: RouteCase[] = [
  {
    name: "GET /api/v1/api-keys",
    method: "GET",
    url: "http://localhost/api/v1/api-keys",
    expectedStatus: 200,
    call: (req) => apiKeys.GET(req),
  },
  {
    name: "POST /api/v1/api-keys",
    method: "POST",
    url: "http://localhost/api/v1/api-keys",
    body: { name: "CI", scope: "read" },
    expectedStatus: 201,
    call: (req) => apiKeys.POST(req),
  },
  {
    name: "GET /api/v1/api-keys/[serial]",
    method: "GET",
    url: "http://localhost/api/v1/api-keys/s_1",
    expectedStatus: 200,
    call: (req) => apiKeySerial.GET(req, serialParams),
  },
  {
    name: "PATCH /api/v1/api-keys/[serial]",
    method: "PATCH",
    url: "http://localhost/api/v1/api-keys/s_1",
    body: { name: "renamed" },
    expectedStatus: 200,
    call: (req) => apiKeySerial.PATCH(req, serialParams),
  },
  {
    name: "DELETE /api/v1/api-keys/[serial]",
    method: "DELETE",
    url: "http://localhost/api/v1/api-keys/s_1",
    expectedStatus: 200,
    call: (req) => apiKeySerial.DELETE(req, serialParams),
  },
  {
    name: "GET /api/v1/sessions",
    method: "GET",
    url: "http://localhost/api/v1/sessions",
    expectedStatus: 200,
    call: (req) => sessions.GET(req),
  },
  {
    name: "POST /api/v1/sessions",
    method: "POST",
    url: "http://localhost/api/v1/sessions",
    body: { phone_number_id: "pn_1", number: "123" },
    expectedStatus: 201,
    call: (req) => sessions.POST(req),
  },
  {
    name: "GET /api/v1/sessions/[serial]",
    method: "GET",
    url: "http://localhost/api/v1/sessions/s_1",
    expectedStatus: 200,
    call: (req) => sessionSerial.GET(req, serialParams),
  },
  {
    name: "DELETE /api/v1/sessions/[serial]",
    method: "DELETE",
    url: "http://localhost/api/v1/sessions/s_1",
    expectedStatus: 204,
    call: (req) => sessionSerial.DELETE(req, serialParams),
  },
  {
    name: "GET /api/v1/sessions/[serial]/status",
    method: "GET",
    url: "http://localhost/api/v1/sessions/s_1/status",
    expectedStatus: 200,
    call: (req) => sessionStatus.GET(req, serialParams),
  },
  {
    name: "POST /api/v1/sessions/[serial]/pairing",
    method: "POST",
    url: "http://localhost/api/v1/sessions/s_1/pairing",
    expectedStatus: 202,
    call: (req) => sessionPairing.POST(req, serialParams),
  },
  {
    name: "GET /api/v1/sessions/[serial]/pairing/qr",
    method: "GET",
    url: "http://localhost/api/v1/sessions/s_1/pairing/qr",
    expectedStatus: 200,
    call: (req) => sessionQr.GET(req, serialParams),
  },
  {
    name: "POST /api/v1/sessions/[serial]/logout",
    method: "POST",
    url: "http://localhost/api/v1/sessions/s_1/logout",
    expectedStatus: 202,
    call: (req) => sessionLogout.POST(req, serialParams),
  },
  {
    name: "GET /api/v1/webhooks",
    method: "GET",
    url: "http://localhost/api/v1/webhooks",
    expectedStatus: 200,
    call: (req) => webhooks.GET(req),
  },
  {
    name: "POST /api/v1/webhooks",
    method: "POST",
    url: "http://localhost/api/v1/webhooks",
    body: { phone_number_id: "pn_1", webhook_url: "https://example.com/hook" },
    expectedStatus: 201,
    call: (req) => webhooks.POST(req),
  },
  {
    name: "GET /api/v1/webhooks/[serial]",
    method: "GET",
    url: "http://localhost/api/v1/webhooks/cfg_1",
    expectedStatus: 200,
    call: (req) => webhookSerial.GET(req, serialParams),
  },
  {
    name: "PATCH /api/v1/webhooks/[serial]",
    method: "PATCH",
    url: "http://localhost/api/v1/webhooks/cfg_1",
    body: { enabled: true },
    expectedStatus: 200,
    call: (req) => webhookSerial.PATCH(req, serialParams),
  },
  {
    name: "DELETE /api/v1/webhooks/[serial]",
    method: "DELETE",
    url: "http://localhost/api/v1/webhooks/cfg_1",
    expectedStatus: 200,
    call: (req) => webhookSerial.DELETE(req, serialParams),
  },
  {
    name: "GET /api/v1/webhooks/[serial]/subscriptions",
    method: "GET",
    url: "http://localhost/api/v1/webhooks/cfg_1/subscriptions",
    expectedStatus: 200,
    call: (req) => subscriptions.GET(req, serialParams),
  },
  {
    name: "POST /api/v1/webhooks/[serial]/subscriptions",
    method: "POST",
    url: "http://localhost/api/v1/webhooks/cfg_1/subscriptions",
    body: { event_type: "messages" },
    expectedStatus: 201,
    call: (req) => subscriptions.POST(req, serialParams),
  },
  {
    name: "DELETE /api/v1/webhooks/[serial]/subscriptions/[eventType]",
    method: "DELETE",
    url: "http://localhost/api/v1/webhooks/cfg_1/subscriptions/messages",
    expectedStatus: 200,
    call: (req) => subscriptionEvent.DELETE(req, eventParams),
  },
  {
    name: "POST /api/v1/webhooks/[serial]/test",
    method: "POST",
    url: "http://localhost/api/v1/webhooks/cfg_1/test",
    expectedStatus: 200,
    call: (req) => webhookTest.POST(req, serialParams),
  },
];

const managementRoutes = routes.filter((r) => r.name.includes("/api/v1/api-keys"));

/** Minimal service stubs shaped for every route's happy path. */
function serviceStubs() {
  return {
    apiKeys: {
      listKeys: vi.fn(async () => []),
      createKey: vi.fn(async () => ({ key: {}, secret: "waba_dev_s" })),
      getKey: vi.fn(async () => ({})),
      updateKey: vi.fn(async () => ({})),
      revokeKey: vi.fn(async () => ({})),
    },
    sessionService: {
      listSessions: vi.fn(async () => []),
      createSession: vi.fn(async () => ({})),
      getSession: vi.fn(async () => ({})),
      deleteSession: vi.fn(async () => true),
      getStatus: vi.fn(async () => ({ status: "connected" })),
      startPairing: vi.fn(async () => ({ jobSerial: "job_1" })),
      getPairingQr: vi.fn(async () => ({
        status: "pending",
        qrCode: "QR",
        qrSerial: "qr_1",
        expiresAt: null,
      })),
      startLogout: vi.fn(async () => ({ jobSerial: "job_1" })),
    },
    webhookManagement: {
      listConfigs: vi.fn(async () => []),
      createConfig: vi.fn(async () => ({})),
      getConfig: vi.fn(async () => ({})),
      updateConfig: vi.fn(async () => ({})),
      deleteConfig: vi.fn(async () => ({})),
      listSubscriptions: vi.fn(async () => []),
      addSubscription: vi.fn(async () => ({})),
      removeSubscription: vi.fn(async () => ({})),
    },
    webhookTest: {
      test: vi.fn(async () => ({})),
    },
  };
}

function invoke(r: RouteCase, token: string | null, scheme?: "basic"): Promise<Response> {
  const headers = new Headers();
  if (scheme === "basic") headers.set("Authorization", "Basic dXNlcjpwYXNz");
  else if (token !== null) headers.set("Authorization", `Bearer ${token}`);
  const req = new NextRequest(r.url, {
    method: r.method,
    headers,
    body: r.body === undefined ? undefined : JSON.stringify(r.body),
  });
  return r.call(req);
}

describe("bootstrap auth parity", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it.each(routes)("$name accepts the configured bootstrap token", async (r) => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });
    mocks.composeServices.mockReturnValue(serviceStubs());

    const res = await invoke(r, "tok");

    expect(res.status).toBe(r.expectedStatus);
    expect(mocks.composeServices).toHaveBeenCalled();
  });
});

describe("rejects missing/wrong/non-Bearer credentials", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it.each(routes)("$name returns the WABA 401 envelope when auth is missing", async (r) => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });

    const res = await invoke(r, null);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(UNAUTHORIZED);
    expect(mocks.composeServices).not.toHaveBeenCalled();
  });

  it.each(routes)("$name returns the WABA 401 envelope for a wrong token", async (r) => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });

    const res = await invoke(r, "wrong");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(UNAUTHORIZED);
    expect(mocks.composeServices).not.toHaveBeenCalled();
  });

  it.each(routes)("$name returns the WABA 401 envelope for a non-Bearer scheme", async (r) => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "tok" });

    const res = await invoke(r, null, "basic");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(UNAUTHORIZED);
    expect(mocks.composeServices).not.toHaveBeenCalled();
  });
});

describe("empty-token closure", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it.each(routes)("$name returns 401 when API_AUTH_TOKEN is empty", async (r) => {
    mocks.loadConfig.mockReturnValue({ apiAuthToken: "" });

    const res = await invoke(r, "anything");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(UNAUTHORIZED);
    expect(mocks.composeServices).not.toHaveBeenCalled();
  });
});

describe("management routes are bootstrap-only", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it.each(managementRoutes)(
    "$name rejects a persisted-key-shaped credential",
    async (r) => {
      mocks.loadConfig.mockReturnValue({ apiAuthToken: "bootstrap-tok" });

      const res = await invoke(r, "waba_dev_0123456789abcdef0123456789abcdef");

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual(UNAUTHORIZED);
      expect(mocks.composeServices).not.toHaveBeenCalled();
    },
  );
});
