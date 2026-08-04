/**
 * Integration tests that call the API exactly as it runs in production: the
 * real Hono app (buildApp) wired to a real PostgREST instance backed by a real
 * Postgres database. No fakes, no mocks, no in-memory substitutes.
 *
 * Gated by TEST_SUPABASE_URL (mirroring the worker's TEST_DATABASE_URL
 * pattern): the whole suite is skipped when unset so the default unit-test run
 * stays fast and hermetic.
 *
 * Run against the local docker-compose stack:
 *   TEST_SUPABASE_URL=http://localhost:3001 \
 *   TEST_SUPABASE_SERVICE_ROLE_KEY=<dev-jwt> \
 *   npx vitest run src/adapters/http/app.integration.test.ts
 *
 * Requires migrations 000003 + 000004 applied and PostgREST schema reloaded.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgrestClient } from "@supabase/postgrest-js";
import type { Hono } from "hono";
import type { Config } from "../../config.js";
import { buildApp } from "../../compose.js";

const TEST_SUPABASE_URL = process.env.TEST_SUPABASE_URL ?? "";
const TEST_SUPABASE_SERVICE_ROLE_KEY =
  process.env.TEST_SUPABASE_SERVICE_ROLE_KEY ?? "";

// Distinct tokens so the auth paths are exercised deterministically.
const API_TOKEN = "itest-api-token";
const INTERNAL_TOKEN = "itest-internal-token";

const describeIntegration = TEST_SUPABASE_URL
  ? describe
  : describe.skip.bind(describe);

// Unique per run so parallel/rerun executions never collide and cleanup is
// always scoped to this test's rows.
const PREFIX = `itest-${Date.now()}-`;

let app: Hono;
let client: PostgrestClient;

describeIntegration("API integration (real PostgREST + Postgres)", () => {
  beforeAll(() => {
    if (!TEST_SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
        "TEST_SUPABASE_SERVICE_ROLE_KEY is required when TEST_SUPABASE_URL is set",
      );
    }
    const config: Config = {
      port: 0,
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseServiceRoleKey: TEST_SUPABASE_SERVICE_ROLE_KEY,
      apiAuthToken: API_TOKEN,
      internalToken: INTERNAL_TOKEN,
      sendTimeoutMs: 2000,
      resultPollMs: 100,
    };
    app = buildApp(config);
    client = new PostgrestClient(TEST_SUPABASE_URL, {
      headers: {
        apikey: TEST_SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${TEST_SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
  });

  afterAll(async () => {
    // Hard-delete every row this run created. webhook_subscriptions and
    // session_qr_codes cascade from their parents.
    await client.from("jobs").delete().like("phone_number_id", `${PREFIX}%`);
    await client.from("sessions").delete().like("phone_number_id", `${PREFIX}%`);
    await client.from("webhook_configs").delete().like("phone_number_id", `${PREFIX}%`);
  });

  /** Dispatch a real HTTP request through the Hono app. */
  function req(
    path: string,
    opts: { method?: string; body?: unknown; token?: string } = {},
  ): Promise<Response> {
    const { method = "GET", body, token = API_TOKEN } = opts;
    const headers: Record<string, string> = {};
    if (token !== "") headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    return Promise.resolve(
      app.request(path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  }

  it("serves the health endpoint", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, service: "api" });
  });

  describe("auth", () => {
    it("rejects /api/v1 requests without a bearer token", async () => {
      const res = await req("/api/v1/sessions", { token: "" });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: { code: number } };
      expect(body.error.code).toBe(190);
    });

    it("rejects /internal/v1 requests without the internal token", async () => {
      const res = await req("/internal/v1/heartbeat", {
        method: "POST",
        body: { phone_number_id: `${PREFIX}none` },
        token: "",
      });
      expect(res.status).toBe(401);
    });
  });

  describe("session lifecycle", () => {
    const phone = `${PREFIX}sess`;
    let serial = "";

    it("creates a session", async () => {
      const res = await req("/api/v1/sessions", {
        method: "POST",
        body: { phone_number_id: phone, number: "628123456789" },
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string; status: string; phone_number_id: string };
      expect(body.id).toBeTruthy();
      expect(body.status).toBe("created");
      expect(body.phone_number_id).toBe(phone);
      serial = body.id;
    });

    it("is idempotent when re-creating the same phone number", async () => {
      const res = await req("/api/v1/sessions", {
        method: "POST",
        body: { phone_number_id: phone, number: "628123456789" },
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string };
      expect(body.id).toBe(serial);
    });

    it("returns 400 for an invalid create payload", async () => {
      const res = await req("/api/v1/sessions", {
        method: "POST",
        body: { number: "628123456789" },
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: number } };
      expect(body.error.code).toBe(100);
    });

    it("fetches the session by serial", async () => {
      const res = await req(`/api/v1/sessions/${serial}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: string; status: string };
      expect(body.id).toBe(serial);
      expect(body.status).toBe("created");
    });

    it("lists sessions including the created one", async () => {
      const res = await req("/api/v1/sessions");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { sessions: { id: string }[] };
      expect(body.sessions.some((s) => s.id === serial)).toBe(true);
    });

    it("returns the session status", async () => {
      const res = await req(`/api/v1/sessions/${serial}/status`);
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ status: "created" });
    });

    it("returns 404 for an unknown session", async () => {
      // Well-formed but non-existent UUID serial (PostgREST rejects malformed
      // UUIDs with a 500 via the transport).
      const res = await req("/api/v1/sessions/00000000-0000-0000-0000-000000000000");
      expect(res.status).toBe(404);
    });

    it("enqueues a pairing job and reports no QR yet", async () => {
      const pairing = await req(`/api/v1/sessions/${serial}/pairing`, {
        method: "POST",
      });
      expect(pairing.status).toBe(202);
      const pairingBody = (await pairing.json()) as { job_serial: string };
      expect(pairingBody.job_serial).toBeTruthy();

      const qr = await req(`/api/v1/sessions/${serial}/pairing/qr`);
      expect(qr.status).toBe(200);
      await expect(qr.json()).resolves.toEqual({
        status: "not_found",
        qr_code: null,
      });
    });

    it("enqueues a logout job", async () => {
      const res = await req(`/api/v1/sessions/${serial}/logout`, {
        method: "POST",
      });
      expect(res.status).toBe(202);
      const body = (await res.json()) as { job_serial: string };
      expect(body.job_serial).toBeTruthy();
    });
  });

  describe("webhook config management", () => {
    const phone = `${PREFIX}webhook`;
    let serial = "";
    let configId = 0;

    it("creates a webhook config with defaults", async () => {
      const res = await req("/api/v1/webhooks", {
        method: "POST",
        body: { phone_number_id: phone, webhook_url: "https://hooks.example.com/itest" },
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        serial: string;
        id: number;
        webhook_url: string;
        enabled: boolean;
        max_retries: number;
      };
      expect(body.serial).toBeTruthy();
      expect(body.webhook_url).toBe("https://hooks.example.com/itest");
      expect(body.enabled).toBe(true);
      expect(body.max_retries).toBe(3);
      serial = body.serial;
      configId = body.id;
    });

    it("rejects re-creating a config for the same phone number", async () => {
      // Unlike sessions, webhook configs are not idempotent on create: the
      // service rejects duplicates with a ValidationError → 400.
      const res = await req("/api/v1/webhooks", {
        method: "POST",
        body: { phone_number_id: phone, webhook_url: "https://hooks.example.com/itest" },
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: number } };
      expect(body.error.code).toBe(100);
    });

    it("fetches the config by serial", async () => {
      const res = await req(`/api/v1/webhooks/${serial}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { serial: string };
      expect(body.serial).toBe(serial);
    });

    it("lists webhook configs including the created one", async () => {
      const res = await req("/api/v1/webhooks");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { webhooks: { serial: string }[] };
      expect(body.webhooks.some((w) => w.serial === serial)).toBe(true);
    });

    it("patches retry policy fields", async () => {
      const res = await req(`/api/v1/webhooks/${serial}`, {
        method: "PATCH",
        body: {
          enabled: false,
          max_retries: 5,
          retry_delay_ms: 2000,
          timeout_ms: 15000,
        },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        enabled: boolean;
        max_retries: number;
        retry_delay_ms: number;
        timeout_ms: number;
      };
      expect(body.enabled).toBe(false);
      expect(body.max_retries).toBe(5);
      expect(body.retry_delay_ms).toBe(2000);
      expect(body.timeout_ms).toBe(15000);
    });

    it("starts with the seeded default messages subscription", async () => {
      const res = await req(`/api/v1/webhooks/${serial}/subscriptions`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { subscriptions: { event_type: string }[] };
      expect(body.subscriptions.map((s) => s.event_type)).toEqual(["messages"]);
    });

    it("adds and lists another subscription", async () => {
      const add = await req(`/api/v1/webhooks/${serial}/subscriptions`, {
        method: "POST",
        body: { event_type: "message_status" },
      });
      expect(add.status).toBe(201);
      const added = (await add.json()) as { event_type: string; webhook_config_id: number };
      expect(added.event_type).toBe("message_status");
      expect(added.webhook_config_id).toBe(configId);

      const list = await req(`/api/v1/webhooks/${serial}/subscriptions`);
      const body = (await list.json()) as { subscriptions: { event_type: string }[] };
      expect(body.subscriptions.map((s) => s.event_type)).toEqual([
        "messages",
        "message_status",
      ]);
    });

    it("is idempotent when re-adding the same event type", async () => {
      const res = await req(`/api/v1/webhooks/${serial}/subscriptions`, {
        method: "POST",
        body: { event_type: "message_status" },
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { event_type: string };
      expect(body.event_type).toBe("message_status");
    });

    it("removes a subscription", async () => {
      const res = await req(`/api/v1/webhooks/${serial}/subscriptions/message_status`, {
        method: "DELETE",
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean };
      expect(body.ok).toBe(true);

      const list = await req(`/api/v1/webhooks/${serial}/subscriptions`);
      const listed = (await list.json()) as { subscriptions: { event_type: string }[] };
      expect(listed.subscriptions.map((s) => s.event_type)).toEqual(["messages"]);
    });

    it("soft-deletes the config and 404s afterwards", async () => {
      const del = await req(`/api/v1/webhooks/${serial}`, { method: "DELETE" });
      expect(del.status).toBe(200);
      const body = (await del.json()) as { ok: boolean };
      expect(body.ok).toBe(true);

      const get = await req(`/api/v1/webhooks/${serial}`);
      expect(get.status).toBe(404);
    });
  });

  describe("internal worker-facing routes", () => {
    const phone = `${PREFIX}internal`;
    let configSerial = "";

    beforeAll(async () => {
      const created = await req("/api/v1/webhooks", {
        method: "POST",
        body: {
          phone_number_id: phone,
          webhook_url: "https://hooks.example.com/internal",
          webhook_secret: "internal-secret",
        },
      });
      expect(created.status).toBe(201);
      const body = (await created.json()) as { serial: string };
      configSerial = body.serial;
    });

    it("serves the webhook config for a phone number (internal v1)", async () => {
      const res = await req(
        `/internal/v1/webhook-config?phone_number_id=${encodeURIComponent(phone)}`,
        { token: INTERNAL_TOKEN },
      );
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        webhook_url: "https://hooks.example.com/internal",
        webhook_secret: "internal-secret",
      });
    });

    it("serves the legacy internal alias", async () => {
      const res = await req(
        `/internal/webhook-config?phone_number_id=${encodeURIComponent(phone)}`,
        { token: INTERNAL_TOKEN },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { webhook_url: string };
      expect(body.webhook_url).toBe("https://hooks.example.com/internal");
    });

    it("updates the session heartbeat", async () => {
      const session = await req("/api/v1/sessions", {
        method: "POST",
        body: { phone_number_id: phone, number: "628111222333" },
      });
      expect(session.status).toBe(201);

      const res = await req("/internal/v1/heartbeat", {
        method: "POST",
        body: { phone_number_id: phone },
        token: INTERNAL_TOKEN,
      });
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ ok: true });

      const sessionBody = (await session.json()) as { id: string };
      const fetched = await req(`/api/v1/sessions/${sessionBody.id}`);
      const fetchedBody = (await fetched.json()) as { last_seen_at: string | null };
      expect(fetchedBody.last_seen_at).toBeTruthy();
    });
  });
});
