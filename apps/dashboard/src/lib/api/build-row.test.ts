import { describe, expect, it } from "vitest";
import { buildApiRequestRow } from "./observability-capture/build-row";

const base = {
  method: "POST",
  path: "/api/waba/v22.0/pn_1/messages",
  status: 201,
  durationMs: 42,
  requestSerial: "bootstrap",
  jobSerial: null,
  phoneNumberId: null,
  businessAccountId: "",
  requestBody: { to: "123" },
  responseBody: { messages: [{ id: "wamid_1" }] },
  requestHeaders: { authorization: "<redacted>" },
  responseHeaders: { "content-type": "application/json" },
};

describe("buildApiRequestRow", () => {
  it("builds an ok row for a successful request", () => {
    const row = buildApiRequestRow(base);

    expect(row.type).toBe("api_request");
    expect(row.status).toBe("ok");
    expect(row.summary).toBe("POST /api/waba/v22.0/pn_1/messages → 201");
    expect(row.requestSerial).toBe("bootstrap");
    expect(row.jobSerial).toBeNull();
    expect(row.phoneNumberId).toBeNull();
    expect(row.businessAccountId).toBe("");

    const payload = row.payload as Record<string, unknown>;
    expect(payload.method).toBe("POST");
    expect(payload.path).toBe("/api/waba/v22.0/pn_1/messages");
    expect(payload.status).toBe(201);
    expect(payload.duration_ms).toBe(42);
    expect(payload.request).toEqual({ headers: { authorization: "<redacted>" }, body: { to: "123" } });
    expect(payload.response).toEqual({
      headers: { "content-type": "application/json" },
      body: { messages: [{ id: "wamid_1" }] },
    });
  });

  it("builds an error row carrying the summarized error", () => {
    const row = buildApiRequestRow({ ...base, error: "boom", status: 500 });

    expect(row.status).toBe("error");
    expect(row.summary).toBe("POST /api/waba/v22.0/pn_1/messages → 500 (error)");
    expect((row.payload as { error: string }).error).toBe("boom");
  });

  it("omits request/response sections when the body read returned null", () => {
    const row = buildApiRequestRow({ ...base, requestBody: null, responseBody: null });

    // The payload keys are present but undefined, mirroring the capture path.
    expect((row.payload as { request?: unknown }).request).toBeUndefined();
    expect((row.payload as { response?: unknown }).response).toBeUndefined();
  });

  it("carries the reported job serial into the row", () => {
    const row = buildApiRequestRow({ ...base, jobSerial: "job_1" });

    expect(row.jobSerial).toBe("job_1");
  });
});