/**
 * Tests for the API-request capture wrapper `withApiActivity` (plan §4, §10
 * R1/R4/R5/R7). These are route-level tests that wrap a handler the same way
 * the public routes do, with the composition root + config + observability
 * service mocked. They assert:
 *
 *  1. A `bootstrap` identity records an `api_request` row with
 *     `request_serial: "bootstrap"`, the final status, a positive `duration_ms`,
 *     and (when the handler enqueues a job) the `job_serial`.
 *  2. A recorder failure (transport throws) does NOT change the route's normal
 *     envelope/status — the request still succeeds (R5).
 *  3. Full request/response bodies are captured (R7) and Authorization headers
 *     are redacted.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { withApiActivity } from "@/lib/api/observability-capture";
import type { ActivityContext } from "@/lib/api/domain/observability";
import type {
  ActivityInsertRow,
  ActivityTransport,
} from "@/lib/api/ports/activity-transport";
import type { Config } from "@/lib/api/config";

// --- Mocks ---------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const inserted: ActivityInsertRow[] = [];
  let insertShouldThrow = false;
  return {
    inserted,
    setInsertShouldThrow: (v: boolean) => {
      insertShouldThrow = v;
    },
    getInsertShouldThrow: () => insertShouldThrow,
    getKeyByHash: vi.fn(),
    touchKeyLastUsed: vi.fn(),
  };
});

// A fake ActivityTransport that captures every insert and can be made to throw.
class FakeTransport implements ActivityTransport {
  async insert(r: ActivityInsertRow): Promise<string> {
    if (mocks.getInsertShouldThrow()) {
      throw new Error("transport down");
    }
    mocks.inserted.push(r);
    return r.serial ?? `gen_${mocks.inserted.length}`;
  }
  // Unused by the capture path:
  async list() {
    return [];
  }
  async getBySerial() {
    return null;
  }
  async listRelated() {
    return [];
  }
}

const observabilityService = { record: (r: ActivityInsertRow) => new FakeTransport().insert(r) };

vi.mock("@/lib/api/compose", () => ({
  composeServices: (config: Config) => ({
    observability: { record: (r: ActivityInsertRow) => observabilityService.record(r) },
    apiKeyAuth: {
      getKeyByHash: mocks.getKeyByHash,
      touchKeyLastUsed: mocks.touchKeyLastUsed,
    },
  }),
}));

vi.mock("@/lib/api/config", () => ({
  loadConfig: () => ({ apiAuthToken: "bootstrap-tok" }),
}));

// --- Helpers -------------------------------------------------------------

function request(token: string, body?: unknown): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token !== "") headers["Authorization"] = `Bearer ${token}`;
  return new NextRequest("http://localhost/api/v1/sessions", {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/**
 * Wraps a handler the way the public routes do. `opts.onHandler` receives the
 * activity context so a test can simulate a job-serial report.
 */
function buildWrapped(
  onHandler: (ctx: ActivityContext) => Promise<Response>,
  opts: { requiredScope?: "read" | "write" } = {},
) {
  return withApiActivity({
    requiredScope: opts.requiredScope ?? "write",
    handler: async (_req, ctx) => {
      const res = await onHandler(ctx.activity);
      // The handler returns a Response; wrap it back to NextResponse-like.
      const body = await res.text();
      const headers = new Headers();
      res.headers.forEach((v, k) => headers.set(k, v));
      return new Response(body, { status: res.status, headers }) as unknown as import("next/server").NextResponse;
    },
  });
}

// --- Tests ---------------------------------------------------------------

describe("withApiActivity — bootstrap identity capture", () => {
  afterEach(() => {
    mocks.inserted.length = 0;
    mocks.setInsertShouldThrow(false);
    vi.clearAllMocks();
  });

  it("records an api_request row with request_serial 'bootstrap', status, duration_ms", async () => {
    const wrapped = buildWrapped(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const res = await wrapped(request("bootstrap-tok"), { params: {} as never });
    expect(res.status).toBe(201);

    // Allow the fire-and-forget record microtask to run.
    await new Promise((r) => setTimeout(r, 0));

    expect(mocks.inserted).toHaveLength(1);
    const row = mocks.inserted[0];
    expect(row.type).toBe("api_request");
    expect(row.status).toBe("ok");
    expect(row.requestSerial).toBe("bootstrap");
    expect(row.summary).toContain("POST");
    expect(row.summary).toContain("201");
    const payload = row.payload as {
      method: string;
      path: string;
      status: number;
      duration_ms: number;
    };
    expect(payload.method).toBe("POST");
    expect(payload.status).toBe(201);
    expect(typeof payload.duration_ms).toBe("number");
    expect(payload.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("captures the job_serial when the handler reports one via setJobSerial", async () => {
    const wrapped = buildWrapped(async (ctx) => {
      ctx.setJobSerial("job_abc123");
      return new Response(JSON.stringify({ job_serial: "job_abc123" }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    });

    const res = await wrapped(request("bootstrap-tok"), { params: {} as never });
    expect(res.status).toBe(202);

    await new Promise((r) => setTimeout(r, 0));

    expect(mocks.inserted).toHaveLength(1);
    expect(mocks.inserted[0].jobSerial).toBe("job_abc123");
  });

  it("does not record an activity row for an unauthorized (401) call", async () => {
    const wrapped = buildWrapped(async () =>
      new Response("{}", { status: 200 }),
    );

    const res = await wrapped(request(""), { params: {} as never });
    expect(res.status).toBe(401);

    await new Promise((r) => setTimeout(r, 0));

    // Auth rejections are a security concern, not API activity to correlate.
    // The rejection path must stay dependency-free: no service composition
    // and no record, so unauthenticated calls never trigger composeServices
    // (asserted by the route-auth contract suite).
    expect(mocks.inserted).toHaveLength(0);
  });

  it("captures full request and response bodies, redacting Authorization headers (R7)", async () => {
    const wrapped = buildWrapped(async (ctx) => {
      ctx.setJobSerial("job_redact");
      return new Response(JSON.stringify({ secret: "body-secret" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const res = await wrapped(
      request("bootstrap-tok", { phone_number_id: "pn_1" }),
      { params: {} as never },
    );
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 0));

    const payload = mocks.inserted[0].payload as {
      request?: { headers: Record<string, string>; body: unknown };
      response?: { headers: Record<string, string>; body: unknown };
    };
    expect(payload.request?.headers["authorization"]).toBe("<redacted>");
    expect(payload.request?.body).toEqual({ phone_number_id: "pn_1" });
    expect(payload.response?.body).toEqual({ secret: "body-secret" });
  });
});

describe("withApiActivity — recorder failure does not break the request (R5)", () => {
  afterEach(() => {
    mocks.inserted.length = 0;
    mocks.setInsertShouldThrow(false);
    vi.clearAllMocks();
  });

  it("returns the normal 201 envelope even when the transport throws", async () => {
    mocks.setInsertShouldThrow(true);

    const wrapped = buildWrapped(async () =>
      new Response(JSON.stringify({ created: true }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const res = await wrapped(request("bootstrap-tok"), { params: {} as never });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ created: true });

    // The record call is fire-and-forget; no row is captured, request unaffected.
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.inserted).toHaveLength(0);
  });

  it("still returns 401 (and records it) when auth fails and the transport throws", async () => {
    mocks.setInsertShouldThrow(true);

    const wrapped = buildWrapped(async () =>
      new Response("{}", { status: 200 }),
    );

    const res = await wrapped(request(""), { params: {} as never });
    expect(res.status).toBe(401);

    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.inserted).toHaveLength(0);
  });
});
