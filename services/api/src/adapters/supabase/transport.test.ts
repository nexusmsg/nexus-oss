import { describe, expect, it } from "vitest";
import type { PostgrestClient } from "@supabase/postgrest-js";
import { SupabaseTransport } from "./transport.js";

type ChainResult = { data: unknown; error: unknown };

interface ChainLogEntry {
  op: "insert" | "select" | "eq" | "is";
  row?: unknown;
  columns?: string;
  column?: string;
  value?: unknown;
}

/**
 * Minimal query-builder fake for `PostgrestClient`: every chain terminator
 * resolves the next queued result in FIFO order. Good enough to exercise the
 * transport's insert / poll / fetch logic without a database.
 */
function createFakeSupabase(results: ChainResult[]) {
  const log: ChainLogEntry[] = [];
  const chain = {
    insert(row: unknown) {
      log.push({ op: "insert", row });
      return chain;
    },
    select(columns: string) {
      log.push({ op: "select", columns });
      return chain;
    },
    eq(column: string, value: unknown) {
      log.push({ op: "eq", column, value });
      return chain;
    },
    is(column: string, value: unknown) {
      log.push({ op: "is", column, value });
      return chain;
    },
    single() {
      return Promise.resolve(results.shift() ?? { data: null, error: null });
    },
    maybeSingle() {
      return Promise.resolve(results.shift() ?? { data: null, error: null });
    },
  };
  const client = { from: () => chain } as unknown as PostgrestClient;
  return { client, log };
}

describe("SupabaseTransport.enqueue", () => {
  it("inserts a send_message job and returns the serial", async () => {
    const { client, log } = createFakeSupabase([
      { data: { serial: "serial-1", status: "pending" }, error: null },
    ]);
    const transport = new SupabaseTransport(client);

    const serial = await transport.enqueue({
      phoneNumberId: "12345",
      payload: { messaging_product: "whatsapp", to: "628123" },
    });

    expect(serial).toBe("serial-1");
    expect(log[0]).toEqual({
      op: "insert",
      row: {
        type: "send_message",
        phone_number_id: "12345",
        payload: { messaging_product: "whatsapp", to: "628123" },
      },
    });
  });

  it("includes idempotency_key in the insert when provided", async () => {
    const { client, log } = createFakeSupabase([
      { data: { serial: "serial-1", status: "pending" }, error: null },
    ]);
    const transport = new SupabaseTransport(client);

    await transport.enqueue({ phoneNumberId: "12345", payload: {}, idempotencyKey: "k-1" });

    expect((log[0].row as Record<string, unknown>).idempotency_key).toBe("k-1");
  });

  it("skips idempotency_key in the insert when it is empty", async () => {
    const { client, log } = createFakeSupabase([
      { data: { serial: "serial-1", status: "pending" }, error: null },
    ]);
    const transport = new SupabaseTransport(client);

    await transport.enqueue({ phoneNumberId: "12345", payload: {}, idempotencyKey: "" });

    expect(log[0].row).toEqual({
      type: "send_message",
      phone_number_id: "12345",
      payload: {},
    });
  });

  it("returns the existing serial on idempotency-key unique violation", async () => {
    const { client, log } = createFakeSupabase([
      { data: null, error: { code: "23505", message: "duplicate key" } },
      { data: { serial: "existing-serial", status: "pending" }, error: null },
    ]);
    const transport = new SupabaseTransport(client);

    const serial = await transport.enqueue({
      phoneNumberId: "12345",
      payload: {},
      idempotencyKey: "k-1",
    });

    expect(serial).toBe("existing-serial");
    // The follow-up lookup filters by idempotency_key and soft-delete.
    const ops = log.filter((e) => e.op === "eq" || e.op === "is");
    expect(ops).toEqual([
      { op: "eq", column: "idempotency_key", value: "k-1" },
      { op: "is", column: "deleted_at", value: null },
    ]);
  });

  it("rejects a unique violation without an idempotency key", async () => {
    const { client } = createFakeSupabase([
      { data: null, error: { code: "23505", message: "duplicate key" } },
    ]);
    const transport = new SupabaseTransport(client);

    await expect(transport.enqueue({ phoneNumberId: "12345", payload: {} })).rejects.toThrow(
      /duplicate key/,
    );
  });

  it("rejects other insert errors", async () => {
    const { client } = createFakeSupabase([
      { data: null, error: { code: "42P01", message: "relation does not exist" } },
    ]);
    const transport = new SupabaseTransport(client);

    await expect(
      transport.enqueue({ phoneNumberId: "12345", payload: {}, idempotencyKey: "k-1" }),
    ).rejects.toThrow(/relation does not exist/);
  });
});

describe("SupabaseTransport.poll", () => {
  it("maps status, result and last_error", async () => {
    const { client, log } = createFakeSupabase([
      {
        data: { status: "failed", result: null, last_error: "boom" },
        error: null,
      },
    ]);
    const transport = new SupabaseTransport(client);

    const result = await transport.poll("serial-1");

    expect(result).toEqual({ status: "failed", result: null, lastError: "boom" });
    const ops = log.filter((e) => e.op === "eq" || e.op === "is");
    expect(ops).toEqual([
      { op: "eq", column: "serial", value: "serial-1" },
      { op: "is", column: "deleted_at", value: null },
    ]);
  });

  it("returns null when the job row is absent", async () => {
    const { client } = createFakeSupabase([{ data: null, error: null }]);
    const transport = new SupabaseTransport(client);

    expect(await transport.poll("serial-1")).toBeNull();
  });
});

describe("SupabaseTransport.getWebhookConfig", () => {
  it("maps the webhook config row", async () => {
    const { client, log } = createFakeSupabase([
      {
        data: {
          id: 1,
          serial: "cfg-1",
          phone_number_id: "12345",
          webhook_url: "https://hooks.example.com",
          webhook_secret: "s3cret",
          enabled: true,
          max_retries: 3,
          retry_delay_ms: 1000,
          timeout_ms: 10000,
          created_at: "2026-01-01T00:00:00Z",
        },
        error: null,
      },
    ]);
    const transport = new SupabaseTransport(client);

    const result = await transport.getWebhookConfig("12345");

    expect(result).toEqual({
      id: 1,
      serial: "cfg-1",
      phoneNumberId: "12345",
      webhookUrl: "https://hooks.example.com",
      webhookSecret: "s3cret",
      enabled: true,
      maxRetries: 3,
      retryDelayMs: 1000,
      timeoutMs: 10000,
      createdAt: "2026-01-01T00:00:00Z",
    });
    const ops = log.filter((e) => e.op === "eq" || e.op === "is");
    expect(ops[0]).toEqual({ op: "eq", column: "phone_number_id", value: "12345" });
    expect(ops[1]).toEqual({ op: "is", column: "deleted_at", value: null });
  });

  it("returns null when no config exists", async () => {
    const { client } = createFakeSupabase([{ data: null, error: null }]);
    const transport = new SupabaseTransport(client);

    expect(await transport.getWebhookConfig("12345")).toBeNull();
  });
});
