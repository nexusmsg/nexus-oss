/**
 * Contract tests for the `obs` middleware feeding the full nested composition
 * `authz(time(obs(handler)))` (replaces the recording-side of the old
 * legacy capture suite). Composition and config are mocked like the old
 * suite. It asserts:
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
import { authz } from "@/lib/api/authz";
import { time } from "@/lib/api/time";
import { obs } from "@/lib/api/observability-capture";
import type { ActivityContext } from "@/lib/api/domain/observability";
import type {
  ActivityInsertRow,
  ActivityTransport,
} from "@/lib/api/ports/activity-transport";

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

const observabilityService = {
  record: (r: ActivityInsertRow) => new FakeTransport().insert(r),
};

vi.mock("@/lib/api/compose", () => ({
  composeServices: () => ({
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
 * Wraps a handler the way the public routes do: outermost `authz`, then `time`,
 * innermost `obs`. `onHandler` receives the activity context so a test can
 * simulate a job-serial report.
 */
function buildWrapped(
  onHandler: (ctx: ActivityContext) => Promise<Response>,
  opts: { requiredScope?: "read" | "write" } = {},
) {
  return authz({ scope: opts.requiredScope ?? "write" })(
    time()(
      obs()(
        async (_req, { activity }) => {
          const res = await onHandler(activity);
          const body = await res.text();
          const headers = new Headers();
          res.headers.forEach((v, k) => headers.set(k, v));
          return new Response(body, {
            status: res.status,
            headers,
          }) as unknown as import("next/server").NextResponse;
        },
      ),
    ),
  );
}

// --- Tests ---------------------------------------------------------------

describe("obs — bootstrap identity capture", () => {
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

describe("obs — recorder failure does not break the request (R5)", () => {
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
});
