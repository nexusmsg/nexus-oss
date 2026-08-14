/**
 * Unit tests for `ObservabilityService` against an in-memory fake implementing
 * the driven `ActivityTransport` port. Covers list filtering (type/status/
 * phone), limit clamping, detail + related resolution (plan §5 correlation
 * columns), the absent-serial 404 path, and mapping to the wire view-model.
 */

import { describe, expect, it } from "vitest";
import type {
  ActivityDetailResponse,
  ActivityEventView,
} from "../domain/observability";
import type {
  ActivityInsertRow,
  ActivityRow,
  ActivityTransport,
} from "../ports/activity-transport";
import { ObservabilityService, mapRow } from "./observability";

const NOW = new Date("2026-08-14T00:00:00.000Z");

function row(overrides: Partial<ActivityRow>): ActivityRow {
  return {
    serial: "a1",
    type: "api_request",
    status: "ok",
    phoneNumberId: null,
    businessAccountId: "",
    summary: "req",
    jobSerial: null,
    waMessageId: null,
    sourceActivitySerial: null,
    resourceType: null,
    resourceSerial: null,
    requestSerial: null,
    payload: null,
    createdAt: NOW,
    ...overrides,
  };
}

/** In-memory ActivityTransport: insert + indexed list/detail/related. */
class FakeTransport implements ActivityTransport {
  rows: ActivityRow[] = [];
  insertCalls: ActivityInsertRow[] = [];

  async insert(r: ActivityInsertRow): Promise<string> {
    this.insertCalls.push(r);
    const serial = r.serial ?? `gen_${this.rows.length + 1}`;
    this.rows.push(row({ serial, ...(r as Partial<ActivityRow>) }));
    return serial;
  }

  async list(filters: {
    type?: ActivityRow["type"];
    status?: ActivityRow["status"];
    phoneNumberId?: string;
    limit?: number;
  }): Promise<ActivityRow[]> {
    let out = [...this.rows];
    if (filters.type !== undefined) out = out.filter((r) => r.type === filters.type);
    if (filters.status !== undefined) {
      out = out.filter((r) => r.status === filters.status);
    }
    if (filters.phoneNumberId !== undefined && filters.phoneNumberId !== "") {
      out = out.filter((r) => r.phoneNumberId === filters.phoneNumberId);
    }
    return out
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, filters.limit ?? 100);
  }

  async getBySerial(serial: string): Promise<ActivityRow | null> {
    return this.rows.find((r) => r.serial === serial) ?? null;
  }

  async listRelated(serial: string): Promise<ActivityRow[]> {
    const target = this.rows.find((r) => r.serial === serial);
    if (target === undefined) return [];
    return this.rows.filter((r) => {
      if (r.serial === serial) return false;
      return (
        (target.jobSerial !== null && r.jobSerial === target.jobSerial) ||
        (target.waMessageId !== null && r.waMessageId === target.waMessageId) ||
        (target.resourceSerial !== null && r.resourceSerial === target.resourceSerial) ||
        (target.sourceActivitySerial !== null &&
          r.serial === target.sourceActivitySerial) ||
        (r.sourceActivitySerial !== null && r.sourceActivitySerial === target.serial)
      );
    });
  }
}

function view(overrides: Partial<ActivityEventView>): ActivityEventView {
  return {
    serial: "a1",
    type: "api_request",
    status: "ok",
    phoneNumberId: null,
    businessAccountId: "",
    summary: "req",
    jobSerial: null,
    waMessageId: null,
    sourceActivitySerial: null,
    resourceType: null,
    resourceSerial: null,
    requestSerial: null,
    payload: null,
    // Match the transport/domain convention: createdAt is stringified with
    // `String(date)` (Date.toString()), not toISOString().
    createdAt: String(NOW),
    ...overrides,
  };
}

describe("mapRow (wire view-model mapping)", () => {
  it("stringifies the createdAt Date and passes correlation columns through", () => {
    const mapped = mapRow(
      row({
        serial: "s1",
        jobSerial: "job_1",
        waMessageId: "wamid_1",
        resourceType: "session",
        resourceSerial: "res_1",
        requestSerial: "bootstrap",
        createdAt: new Date("2026-08-14T12:34:56.000Z"),
      }),
    );
    expect(mapped).toEqual(
      view({
        serial: "s1",
        jobSerial: "job_1",
        waMessageId: "wamid_1",
        resourceType: "session",
        resourceSerial: "res_1",
        requestSerial: "bootstrap",
        createdAt: String(new Date("2026-08-14T12:34:56.000Z")),
      }),
    );
  });

  it("normalizes undefined correlation columns to null", () => {
    const mapped = mapRow(row({}));
    expect(mapped.jobSerial).toBeNull();
    expect(mapped.phoneNumberId).toBeNull();
    expect(mapped.resourceType).toBeNull();
  });
});

describe("ObservabilityService.list", () => {
  it("returns newest-first and maps to wire shape", async () => {
    const transport = new FakeTransport();
    transport.rows = [
      row({ serial: "old", createdAt: new Date("2026-08-01T00:00:00.000Z") }),
      row({ serial: "new", createdAt: new Date("2026-08-13T00:00:00.000Z") }),
    ];
    const service = new ObservabilityService(transport);

    const res = await service.list({});
    expect(res.activities.map((a) => a.serial)).toEqual(["new", "old"]);
    expect(res.activities[0]).toEqual(
      view({
        serial: "new",
        createdAt: String(new Date("2026-08-13T00:00:00.000Z")),
      }),
    );
  });

  it("filters by type", async () => {
    const transport = new FakeTransport();
    transport.rows = [
      row({ serial: "api", type: "api_request" }),
      row({ serial: "wa", type: "whatsapp_event" }),
    ];
    const service = new ObservabilityService(transport);

    const res = await service.list({ type: "api_request" });
    expect(res.activities.map((a) => a.serial)).toEqual(["api"]);
  });

  it("filters by status", async () => {
    const transport = new FakeTransport();
    transport.rows = [
      row({ serial: "ok", status: "ok" }),
      row({ serial: "err", status: "error" }),
    ];
    const service = new ObservabilityService(transport);

    const res = await service.list({ status: "error" });
    expect(res.activities.map((a) => a.serial)).toEqual(["err"]);
  });

  it("filters by phone_number_id", async () => {
    const transport = new FakeTransport();
    transport.rows = [
      row({ serial: "p1", phoneNumberId: "123" }),
      row({ serial: "p2", phoneNumberId: "456" }),
    ];
    const service = new ObservabilityService(transport);

    const res = await service.list({ phoneNumberId: "123" });
    expect(res.activities.map((a) => a.serial)).toEqual(["p1"]);
  });

  it("combines type + status + phone filters", async () => {
    const transport = new FakeTransport();
    transport.rows = [
      row({ serial: "match", type: "api_request", status: "ok", phoneNumberId: "123" }),
      row({ serial: "typeOnly", type: "api_request", status: "error", phoneNumberId: "123" }),
      row({ serial: "phoneOnly", type: "whatsapp_event", status: "ok", phoneNumberId: "123" }),
      row({ serial: "statusOnly", type: "api_request", status: "ok", phoneNumberId: "999" }),
    ];
    const service = new ObservabilityService(transport);

    const res = await service.list({ type: "api_request", status: "ok", phoneNumberId: "123" });
    expect(res.activities.map((a) => a.serial)).toEqual(["match"]);
  });

  it("clamps an over-large limit and floors a non-positive limit", async () => {
    const transport = new FakeTransport();
    for (let i = 0; i < 50; i++) {
      transport.rows.push(row({ serial: `r${i}` }));
    }
    const service = new ObservabilityService(transport);

    await expect(service.list({ limit: 5000 })).resolves.toMatchObject({
      activities: expect.arrayContaining([expect.objectContaining({ serial: "r0" })]),
    });
    // clampLimit(5000) -> MAX_LIST_LIMIT (1000); the fake caps at 1000 but only
    // has 50 rows, so all 50 are returned.
    const big = await service.list({ limit: 5000 });
    expect(big.activities.length).toBe(50);
    // clampLimit(0) floors to 1; the fake strictly applies the sent limit of 1.
    const small = await service.list({ limit: 0 });
    expect(small.activities.length).toBe(1);
  });
});

describe("ObservabilityService.detail", () => {
  it("returns null for an unknown serial", async () => {
    const service = new ObservabilityService(new FakeTransport());
    await expect(service.detail("missing")).resolves.toBeNull();
  });

  it("resolves related rows across every correlation column (plan §5)", async () => {
    const transport = new FakeTransport();
    // The target: an API request that enqueued a job.
    transport.rows = [
      row({
        serial: "target",
        type: "api_request",
        jobSerial: "job_1",
      }),
      // Linked by job_serial (API request -> outbound send / executor row).
      row({
        serial: "byJob",
        type: "whatsapp_event",
        jobSerial: "job_1",
      }),
      // Linked by wa_message_id (outbound send <-> inbound event).
      row({
        serial: "byWamid",
        type: "whatsapp_event",
        waMessageId: "wamid_9",
      }),
      // Linked by resource_serial.
      row({
        serial: "byResource",
        type: "webhook_delivery",
        resourceSerial: "res_7",
      }),
      // Linked because it points at the target (source_activity_serial).
      row({
        serial: "bySource",
        type: "webhook_delivery",
        sourceActivitySerial: "target",
      }),
      // The target points at this row (target.source_activity_serial).
      row({
        serial: "pointedAt",
        type: "whatsapp_event",
        sourceActivitySerial: "other",
      }),
      // Unrelated.
      row({ serial: "unrelated", type: "api_request" }),
    ];
    // Give the target a source_activity_serial too, to exercise the
    // "anything this row points at" branch.
    transport.rows[0].sourceActivitySerial = "pointedAt";
    transport.rows[0].waMessageId = "wamid_9";
    transport.rows[0].resourceSerial = "res_7";

    const service = new ObservabilityService(transport);
    const res = await service.detail("target");
    expect(res).not.toBeNull();

    const relatedSerials = (res as ActivityDetailResponse).related.map(
      (r: ActivityEventView) => r.serial,
    );
    expect(relatedSerials.sort()).toEqual(
      ["byJob", "byWamid", "byResource", "bySource", "pointedAt"].sort(),
    );
    expect(relatedSerials).not.toContain("unrelated");
    expect(relatedSerials).not.toContain("target");
    expect((res as ActivityDetailResponse).activity.serial).toBe("target");
  });
});

describe("ObservabilityService.record (R4 fire-and-forget path)", () => {
  it("delegates to the transport.insert and returns the serial", async () => {
    const transport = new FakeTransport();
    const service = new ObservabilityService(transport);

    const serial = await service.record({ type: "api_request", status: "ok" });
    expect(transport.insertCalls).toHaveLength(1);
    expect(serial).toMatch(/^gen_/);
  });

  it("never throws synchronously from record (returns a Promise)", () => {
    // A synchronous call to record must not throw before the await; the
    // transport's insert is invoked lazily inside the returned promise.
    const service = new ObservabilityService(new FakeTransport());
    const result = service.record({ type: "api_request", status: "ok" });
    expect(result).toBeInstanceOf(Promise);
    // Resolves without a .catch so callers can safely `void ... .catch(log)`.
    void result;
  });

  it("propagates transport errors to the returned promise (caller .catch log)", async () => {
    const failing: ActivityTransport = {
      insert: () => Promise.reject(new Error("db down")),
      list: () => Promise.resolve([]),
      getBySerial: () => Promise.resolve(null),
      listRelated: () => Promise.resolve([]),
    };
    const service = new ObservabilityService(failing);
    await expect(service.record({ type: "api_request", status: "ok" })).rejects.toThrow(
      "db down",
    );
  });
});
