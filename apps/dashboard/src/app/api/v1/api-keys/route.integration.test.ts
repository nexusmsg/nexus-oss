/**
 * API-key integration tests (API-6): the real Next route → Drizzle → Postgres
 * path. No fakes, no mocks — the actual route handlers, `composeServices`,
 * `DrizzleTransport`, and the async authorizer (`authorizeApi` /
 * `authorizeInternal`) run against a real database.
 *
 * Gated by `TEST_DATABASE_URL` (mirroring the worker's `TEST_DATABASE_URL` and
 * the archived Hono API's `TEST_SUPABASE_URL` gating): the whole suite is
 * skipped when unset so the default unit-test run stays fast and hermetic.
 *
 * Run against the local docker-compose stack (migration 000011 applied):
 *   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/waba \
 *   npx vitest run src/app/api/v1/api-keys/route.integration.test.ts
 *
 * Requires the `api_keys` table (000011_create_api_keys) to exist on the
 * target database. Rows created by this suite are hard-deleted in `afterAll`
 * (serial-scoped to this run), mirroring the archived integration-test
 * cleanup convention.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import postgres from "postgres";
import { GET as apiKeysList, POST as apiKeysCreate } from "./route";
import {
  DELETE as apiKeyRevoke,
  GET as apiKeyGet,
  PATCH as apiKeyPatch,
} from "./[serial]/route";
import { GET as sessionsList } from "../sessions/route";
import { PATCH as webhookPatch } from "../webhooks/[serial]/route";
import { GET as internalWebhookConfig } from "../../internal/v1/webhook-config/route";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
const BOOTSTRAP_TOKEN = "itest-bootstrap-token";
const INTERNAL_TOKEN = "itest-internal-token";
const BASE_URL = "http://localhost";

/** Redacted management wire shape returned by the api-keys routes. */
interface WireKey {
  serial: string;
  name: string;
  key_prefix: string;
  scope: string;
  status: string;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CreateResponse {
  key: WireKey;
  secret: string;
}

const serialParams = (serial: string) => ({ params: Promise.resolve({ serial }) });

function bearer(
  method: string,
  path: string,
  token: string,
  body?: unknown,
): NextRequest {
  return new NextRequest(`${BASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe.skipIf(!TEST_DATABASE_URL)(
  "api-key integration (real route → Drizzle → Postgres)",
  () => {
    let sql: ReturnType<typeof postgres> | null = null;
    const serials: string[] = [];
    let fullSerial = "";
    let fullSecret = "";
    let readSerial = "";
    let readSecret = "";

    beforeAll(async () => {
      process.env.DATABASE_URL = TEST_DATABASE_URL;
      process.env.API_AUTH_TOKEN = BOOTSTRAP_TOKEN;
      process.env.INTERNAL_TOKEN = INTERNAL_TOKEN;
      process.env.API_KEY_ENV = "itest";
      sql = postgres(TEST_DATABASE_URL, { max: 1 });

      // Seed one `full` and one `read` key through the real create route.
      const fullRes = await apiKeysCreate(
        bearer("POST", "/api/v1/api-keys", BOOTSTRAP_TOKEN, {
          name: "itest-full",
          scope: "full",
        }),
      );
      const fullBody = (await fullRes.json()) as CreateResponse;
      fullSerial = fullBody.key.serial;
      fullSecret = fullBody.secret;

      const readRes = await apiKeysCreate(
        bearer("POST", "/api/v1/api-keys", BOOTSTRAP_TOKEN, {
          name: "itest-read",
          scope: "read",
        }),
      );
      const readBody = (await readRes.json()) as CreateResponse;
      readSerial = readBody.key.serial;
      readSecret = readBody.secret;

      serials.push(fullSerial, readSerial);
    });

    afterAll(async () => {
      if (sql && serials.length > 0) {
        await sql`delete from api_keys where serial = any(${sql.array(serials)})`.catch(
          () => undefined,
        );
      }
      if (sql) {
        await sql.end().catch(() => undefined);
      }
    });

    /** Poll the management route until the fire-and-forget last-used touch lands. */
    async function waitForLastUsed(serial: string): Promise<string | null> {
      for (let i = 0; i < 30; i++) {
        const res = await apiKeyGet(
          bearer("GET", `/api/v1/api-keys/${serial}`, BOOTSTRAP_TOKEN),
          serialParams(serial),
        );
        const body = (await res.json()) as WireKey;
        if (body.last_used_at !== null) return body.last_used_at;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return null;
    }

    it("returns the plaintext secret exactly once and a redacted key on create", async () => {
      const res = await apiKeysCreate(
        bearer("POST", "/api/v1/api-keys", BOOTSTRAP_TOKEN, {
          name: "itest-ci",
          scope: "full",
        }),
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as CreateResponse;

      // `waba_<env>_<64 hex chars>`: 256 bits of entropy from the real service.
      expect(body.secret).toMatch(/^waba_itest_[0-9a-f]{64}$/);
      expect(body.key.serial).toEqual(expect.any(String));
      expect(body.key.key_prefix).toBe("waba_itest_");
      expect(body.key.scope).toBe("full");
      expect(body.key.status).toBe("active");

      // Redaction: the key object never carries the secret or any hash.
      expect(body.key).not.toHaveProperty("secret");
      expect(body.key).not.toHaveProperty("key_hash");
      expect(body.key).not.toHaveProperty("keyHash");

      serials.push(body.key.serial);
    });

    it("lists redacted keys through the management route", async () => {
      const res = await apiKeysList(
        bearer("GET", "/api/v1/api-keys", BOOTSTRAP_TOKEN),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { api_keys: WireKey[] };

      const found = body.api_keys.find((k) => k.serial === fullSerial);
      expect(found).toBeDefined();
      expect(found?.name).toBe("itest-full");
      expect(found?.key_prefix).toBe("waba_itest_");
      expect(found).not.toHaveProperty("secret");
      expect(found).not.toHaveProperty("key_hash");
      expect(found).not.toHaveProperty("keyHash");
    });

    it("authenticates a persisted key on a public route and records last_used_at", async () => {
      const res = await sessionsList(
        bearer("GET", "/api/v1/sessions", fullSecret),
      );
      expect(res.status).toBe(200);

      // The touch is best-effort/fire-and-forget; poll until it lands.
      expect(await waitForLastUsed(fullSerial)).not.toBeNull();
    });

    it("throttles last_used_at to once per five minutes", async () => {
      const before = await waitForLastUsed(fullSerial);
      expect(before).not.toBeNull();

      const res = await sessionsList(
        bearer("GET", "/api/v1/sessions", fullSecret),
      );
      expect(res.status).toBe(200);
      // Allow a (suppressed) write attempt to settle before reading back.
      await new Promise((resolve) => setTimeout(resolve, 150));

      const afterRes = await apiKeyGet(
        bearer("GET", `/api/v1/api-keys/${fullSerial}`, BOOTSTRAP_TOKEN),
        serialParams(fullSerial),
      );
      const after = (await afterRes.json()) as WireKey;
      expect(after.last_used_at).toBe(before);
    });

    it("enforces the scope matrix on the real path", async () => {
      // read-scoped key: allowed on a read route, rejected on a write route.
      // Use a valid UUID so the route reaches its 404 behavior instead of
      // failing during Postgres UUID parameter casting.
      const missingWebhookSerial = "00000000-0000-0000-0000-000000000404";
      expect(
        (await sessionsList(bearer("GET", "/api/v1/sessions", readSecret))).status,
      ).toBe(200);
      expect(
        (
          await webhookPatch(
            bearer("PATCH", `/api/v1/webhooks/${missingWebhookSerial}`, readSecret, {
              enabled: true,
            }),
            serialParams(missingWebhookSerial),
          )
        ).status,
      ).toBe(401);

      // full-scoped key: write scope granted → 404 = auth passed, config absent.
      expect(
        (
          await webhookPatch(
            bearer("PATCH", `/api/v1/webhooks/${missingWebhookSerial}`, fullSecret, {
              enabled: true,
            }),
            serialParams(missingWebhookSerial),
          )
        ).status,
      ).toBe(404);
    });

    it("rejects persisted keys on management routes (bootstrap-only)", async () => {
      const list = await apiKeysList(
        bearer("GET", "/api/v1/api-keys", fullSecret),
      );
      expect(list.status).toBe(401);

      const create = await apiKeysCreate(
        bearer("POST", "/api/v1/api-keys", fullSecret, {
          name: "nope",
          scope: "read",
        }),
      );
      expect(create.status).toBe(401);

      const patch = await apiKeyPatch(
        bearer("PATCH", `/api/v1/api-keys/${fullSerial}`, fullSecret, {
          name: "nope",
        }),
        serialParams(fullSerial),
      );
      expect(patch.status).toBe(401);

      const revoke = await apiKeyRevoke(
        bearer("DELETE", `/api/v1/api-keys/${fullSerial}`, fullSecret),
        serialParams(fullSerial),
      );
      expect(revoke.status).toBe(401);
    });

    it("rejects a revoked key (DELETE → revoke, never hard-delete)", async () => {
      const revokeRes = await apiKeyRevoke(
        bearer("DELETE", `/api/v1/api-keys/${readSerial}`, BOOTSTRAP_TOKEN),
        serialParams(readSerial),
      );
      expect(revokeRes.status).toBe(200);
      expect(await revokeRes.json()).toEqual({ ok: true });

      const getRes = await apiKeyGet(
        bearer("GET", `/api/v1/api-keys/${readSerial}`, BOOTSTRAP_TOKEN),
        serialParams(readSerial),
      );
      expect(((await getRes.json()) as WireKey).status).toBe("revoked");

      const authRes = await sessionsList(
        bearer("GET", "/api/v1/sessions", readSecret),
      );
      expect(authRes.status).toBe(401);
    });

    it("rejects an expired key", async () => {
      const created = await apiKeysCreate(
        bearer("POST", "/api/v1/api-keys", BOOTSTRAP_TOKEN, {
          name: "itest-expiry",
          scope: "full",
        }),
      );
      const body = (await created.json()) as CreateResponse;
      serials.push(body.key.serial);

      // Back-date the row directly: the service only accepts future expiries.
      await sql!`update api_keys set expires_at = now() - interval '1 day' where serial = ${body.key.serial}`;

      const res = await sessionsList(
        bearer("GET", "/api/v1/sessions", body.secret),
      );
      expect(res.status).toBe(401);
    });

    it("strictly isolates INTERNAL_TOKEN from bootstrap and persisted credentials", async () => {
      const path = "/internal/v1/webhook-config?phone_number_id=itest-nonexistent";

      const persisted = await internalWebhookConfig(
        bearer("GET", path, fullSecret),
      );
      expect(persisted.status).toBe(401);

      const bootstrap = await internalWebhookConfig(
        bearer("GET", path, BOOTSTRAP_TOKEN),
      );
      expect(bootstrap.status).toBe(401);

      const internal = await internalWebhookConfig(
        bearer("GET", path, INTERNAL_TOKEN),
      );
      // 404 = auth passed and the config is absent; 200 = an existing row.
      expect([200, 404]).toContain(internal.status);
    });

    it("closes public routes when API_AUTH_TOKEN is empty, even for a valid key", async () => {
      process.env.API_AUTH_TOKEN = "";
      try {
        const res = await sessionsList(
          bearer("GET", "/api/v1/sessions", fullSecret),
        );
        expect(res.status).toBe(401);
      } finally {
        process.env.API_AUTH_TOKEN = BOOTSTRAP_TOKEN;
      }
    });
  },
);
