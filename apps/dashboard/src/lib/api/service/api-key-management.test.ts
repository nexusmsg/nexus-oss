/**
 * Unit + functional tests for `ApiKeyManagementService` against an in-memory
 * fake implementing the driven `ApiKeyTransport` port. Covers secure key
 * generation, SHA-256 hashing, one-time plaintext return, input validation,
 * partial update, revoke, expired/revoked visibility, and environment
 * resolution for the `waba_<env>_` prefix.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ApiKey, ApiKeyScope } from "../domain/api-key";
import { ValidationError } from "../domain/errors";
import type {
  ApiKeyTransport,
  CreateApiKeyInput,
  UpdateApiKeyInput,
} from "../ports/api-key-transport";
import {
  ApiKeyManagementService,
  generateApiKeySecret,
  hashApiKeySecret,
  resolveApiKeyEnvironment,
} from "./api-key-management";

/**
 * In-memory implementation of the driven port; mirrors the real adapter's
 * semantics: soft-deleted rows are excluded everywhere, revoke is idempotent,
 * and `updateKey`/`revokeKey` return null for absent rows.
 */
class FakeTransport implements ApiKeyTransport {
  keys = new Map<string, ApiKey>();
  /** Insertion order for list (newest first = reverse). */
  order: string[] = [];
  nextSerial = 1;
  clock = 0;
  createCalls: CreateApiKeyInput[] = [];

  /** Seed a key directly, bypassing the service (for expired/revoked states). */
  seed(key: Partial<ApiKey> & { serial: string }): ApiKey {
    const full: ApiKey = {
      name: "seeded",
      keyPrefix: "waba_test_",
      keyHash: "seeded-hash",
      scope: "read",
      status: "active",
      expiresAt: null,
      lastUsedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      deletedAt: null,
      ...key,
    };
    this.keys.set(full.serial, full);
    this.order.push(full.serial);
    return full;
  }

  async createKey(input: CreateApiKeyInput): Promise<ApiKey> {
    this.createCalls.push(input);
    const serial = `key_${this.nextSerial++}`;
    this.clock += 1;
    const key: ApiKey = {
      serial,
      name: input.name,
      keyPrefix: input.keyPrefix,
      keyHash: input.keyHash,
      scope: input.scope,
      status: "active",
      expiresAt: input.expiresAt ?? null,
      lastUsedAt: null,
      createdAt: `2026-08-12T00:00:0${this.clock}.000Z`,
      updatedAt: `2026-08-12T00:00:0${this.clock}.000Z`,
      deletedAt: null,
    };
    this.keys.set(serial, key);
    this.order.push(serial);
    return key;
  }

  async listKeys(): Promise<ApiKey[]> {
    return [...this.order]
      .reverse()
      .map((serial) => this.keys.get(serial))
      .filter((key): key is ApiKey => key !== undefined && key.deletedAt === null);
  }

  async getKey(serial: string): Promise<ApiKey | null> {
    const key = this.keys.get(serial);
    return key === undefined || key.deletedAt !== null ? null : key;
  }

  async getKeyByHash(keyHash: string): Promise<ApiKey | null> {
    for (const key of this.keys.values()) {
      if (key.keyHash === keyHash && key.deletedAt === null) return key;
    }
    return null;
  }

  async updateKey(
    serial: string,
    input: UpdateApiKeyInput,
  ): Promise<ApiKey | null> {
    const key = this.keys.get(serial);
    if (key === undefined || key.deletedAt !== null) return null;
    const updated: ApiKey = {
      ...key,
      name: input.name ?? key.name,
      scope: input.scope ?? key.scope,
      expiresAt: input.expiresAt === undefined ? key.expiresAt : input.expiresAt,
      updatedAt: "2026-08-12T00:01:00.000Z",
    };
    this.keys.set(serial, updated);
    return updated;
  }

  async revokeKey(serial: string): Promise<ApiKey | null> {
    const key = this.keys.get(serial);
    if (key === undefined || key.deletedAt !== null) return null;
    const updated: ApiKey = {
      ...key,
      status: "revoked",
      updatedAt: "2026-08-12T00:02:00.000Z",
    };
    this.keys.set(serial, updated);
    return updated;
  }

  async touchKeyLastUsed(serial: string): Promise<void> {
    const key = this.keys.get(serial);
    if (key === undefined || key.deletedAt !== null || key.status !== "active") {
      return;
    }
    this.keys.set(serial, {
      ...key,
      lastUsedAt: "2026-08-12T00:00:00.000Z",
    });
  }
}

const FUTURE = "2099-12-31T00:00:00.000Z";
const PAST = "2000-01-01T00:00:00.000Z";
/** Full secret shape: `waba_<env>_` + 32 bytes hex (64 chars). */
const KEY_SECRET_FORMAT = /^waba_test_[0-9a-f]{64}$/;

function makeService(transport: ApiKeyTransport): ApiKeyManagementService {
  return new ApiKeyManagementService(transport, { environment: "test" });
}

/** Runtime view used to assert that no secret material leaks onto records. */
function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

describe("ApiKeyManagementService", () => {
  describe("createKey / generation", () => {
    it("generates a waba_<env>_ secret with at least 32 random bytes", async () => {
      const transport = new FakeTransport();
      const service = makeService(transport);

      const result = await service.createKey({ name: "CI key", scope: "read" });

      expect(result.secret).toMatch(KEY_SECRET_FORMAT);
      const randomPart = result.secret.replace("waba_test_", "");
      expect(Buffer.from(randomPart, "hex")).toHaveLength(32);

      expect(transport.createCalls).toHaveLength(1);
      expect(transport.createCalls[0].keyPrefix).toBe("waba_test_");
      expect(result.key.keyPrefix).toBe("waba_test_");
    });

    it("generates unique secrets and hashes across creates", async () => {
      const service = makeService(new FakeTransport());

      const first = await service.createKey({ name: "a", scope: "read" });
      const second = await service.createKey({ name: "b", scope: "read" });

      expect(second.secret).not.toBe(first.secret);
      expect(second.key.serial).not.toBe(first.key.serial);
    });

    it("honors an explicit environment option in the prefix", async () => {
      const service = new ApiKeyManagementService(new FakeTransport(), {
        environment: "prod",
      });

      const result = await service.createKey({ name: "prod key", scope: "full" });

      expect(result.secret).toMatch(/^waba_prod_[0-9a-f]{64}$/);
      expect(result.key.keyPrefix).toBe("waba_prod_");
    });
  });

  describe("hashing", () => {
    it("stores a SHA-256 hex digest of the full secret", async () => {
      const transport = new FakeTransport();
      const service = makeService(transport);

      const result = await service.createKey({ name: "hash me", scope: "read" });

      const expected = createHash("sha256").update(result.secret).digest("hex");
      expect(transport.createCalls[0].keyHash).toBe(expected);
      expect(transport.createCalls[0].keyHash).toMatch(/^[0-9a-f]{64}$/);
      expect(transport.createCalls[0].keyHash).not.toBe(result.secret);
    });

    it("is deterministic and sensitive to the input", () => {
      expect(hashApiKeySecret("same")).toBe(hashApiKeySecret("same"));
      expect(hashApiKeySecret("same")).not.toBe(hashApiKeySecret("different"));
    });
  });

  describe("one-time plaintext", () => {
    it("never persists the plaintext secret", async () => {
      const transport = new FakeTransport();
      const service = makeService(transport);

      const result = await service.createKey({ name: "secret", scope: "write" });
      const stored = transport.keys.get(result.key.serial);
      expect(stored).toBeDefined();
      expect(Object.values(stored as unknown as Record<string, unknown>)).not.toContain(
        result.secret,
      );
      expect(stored?.keyHash).toBe(hashApiKeySecret(result.secret));
    });

    it("returns the secret only from create; reads stay redacted", async () => {
      const transport = new FakeTransport();
      const service = makeService(transport);
      const result = await service.createKey({ name: "redact me", scope: "full" });
      const serial = result.key.serial;

      // The create result itself carries the secret on the result object, not the record.
      expect(asRecord(result.key).secret).toBeUndefined();
      expect(asRecord(result.key).keyHash).toBeUndefined();

      const read = await service.getKey(serial);
      expect(asRecord(read).secret).toBeUndefined();
      expect(asRecord(read).keyHash).toBeUndefined();

      const [listed] = await service.listKeys();
      expect(asRecord(listed).secret).toBeUndefined();
      expect(asRecord(listed).keyHash).toBeUndefined();

      const updated = await service.updateKey(serial, { name: "renamed" });
      expect(asRecord(updated).secret).toBeUndefined();
      expect(asRecord(updated).keyHash).toBeUndefined();

      const revoked = await service.revokeKey(serial);
      expect(asRecord(revoked).secret).toBeUndefined();
      expect(asRecord(revoked).keyHash).toBeUndefined();
    });
  });

  describe("create validation", () => {
    const service = makeService(new FakeTransport());

    it("rejects a missing or blank name", async () => {
      await expect(service.createKey({ name: "", scope: "read" })).rejects.toThrow(
        ValidationError,
      );
      await expect(
        service.createKey({ name: "   ", scope: "read" }),
      ).rejects.toThrow("name is required");
    });

    it("rejects an over-long name", async () => {
      await expect(
        service.createKey({ name: "n".repeat(201), scope: "read" }),
      ).rejects.toThrow("name must be at most 200 characters");
    });

    it("rejects an invalid scope", async () => {
      await expect(
        service.createKey({ name: "x", scope: "admin" as ApiKeyScope }),
      ).rejects.toThrow(ValidationError);
      await expect(
        service.createKey({ name: "x", scope: "admin" as ApiKeyScope }),
      ).rejects.toThrow("scope must be one of: read, write, full");
    });

    it("rejects a past or unparseable expiry", async () => {
      await expect(
        service.createKey({ name: "x", scope: "read", expiresAt: PAST }),
      ).rejects.toThrow("expires_at must be in the future");
      await expect(
        service.createKey({ name: "x", scope: "read", expiresAt: "not-a-date" }),
      ).rejects.toThrow("expires_at must be a valid date");
    });

    it("accepts null, omitted, and future expiry", async () => {
      const transport = new FakeTransport();
      const svc = makeService(transport);

      await svc.createKey({ name: "no expiry", scope: "read", expiresAt: null });
      await svc.createKey({ name: "omitted", scope: "read" });
      await svc.createKey({ name: "future", scope: "read", expiresAt: FUTURE });

      expect(transport.createCalls.map((c) => c.expiresAt)).toEqual([
        null,
        null,
        FUTURE,
      ]);
    });
  });

  describe("updateKey", () => {
    it("applies a partial update and persists it", async () => {
      const transport = new FakeTransport();
      const service = makeService(transport);
      const created = await service.createKey({ name: "original", scope: "read" });

      const updated = await service.updateKey(created.key.serial, {
        name: "renamed",
        scope: "write",
        expiresAt: FUTURE,
      });

      expect(updated?.name).toBe("renamed");
      expect(updated?.scope).toBe("write");
      expect(updated?.expiresAt).toBe(FUTURE);

      const read = await service.getKey(created.key.serial);
      expect(read?.name).toBe("renamed");
      expect(read?.scope).toBe("write");
      expect(read?.expiresAt).toBe(FUTURE);
    });

    it("clears expiry with null", async () => {
      const transport = new FakeTransport();
      const service = makeService(transport);
      const created = await service.createKey({
        name: "expiring",
        scope: "read",
        expiresAt: FUTURE,
      });

      const updated = await service.updateKey(created.key.serial, {
        expiresAt: null,
      });

      expect(updated?.expiresAt).toBeNull();
    });

    it("returns null for an unknown serial", async () => {
      const service = makeService(new FakeTransport());

      await expect(
        service.updateKey("nope", { name: "renamed" }),
      ).resolves.toBeNull();
    });

    it("allows renaming a revoked key", async () => {
      const transport = new FakeTransport();
      const service = makeService(transport);
      const created = await service.createKey({ name: "doomed", scope: "read" });
      await service.revokeKey(created.key.serial);

      const updated = await service.updateKey(created.key.serial, {
        name: "doomed (rotated)",
      });

      expect(updated?.name).toBe("doomed (rotated)");
      expect(updated?.status).toBe("revoked");
    });

    it("rejects an empty update", async () => {
      const transport = new FakeTransport();
      const service = makeService(transport);
      const created = await service.createKey({ name: "x", scope: "read" });

      await expect(service.updateKey(created.key.serial, {})).rejects.toThrow(
        ValidationError,
      );
      await expect(service.updateKey(created.key.serial, {})).rejects.toThrow(
        "no fields to update",
      );
    });

    it("rejects invalid scope and past expiry on update", async () => {
      const transport = new FakeTransport();
      const service = makeService(transport);
      const created = await service.createKey({ name: "x", scope: "read" });

      await expect(
        service.updateKey(created.key.serial, { scope: "admin" as ApiKeyScope }),
      ).rejects.toThrow("scope must be one of: read, write, full");
      await expect(
        service.updateKey(created.key.serial, { expiresAt: PAST }),
      ).rejects.toThrow("expires_at must be in the future");
    });
  });

  describe("revokeKey", () => {
    it("transitions a key to revoked and keeps it visible", async () => {
      const transport = new FakeTransport();
      const service = makeService(transport);
      const created = await service.createKey({ name: "revoke me", scope: "read" });

      const revoked = await service.revokeKey(created.key.serial);

      expect(revoked?.status).toBe("revoked");
      expect(revoked?.serial).toBe(created.key.serial);

      const read = await service.getKey(created.key.serial);
      expect(read?.status).toBe("revoked");

      const listed = await service.listKeys();
      expect(listed.map((k) => k.serial)).toContain(created.key.serial);
      expect(listed.find((k) => k.serial === created.key.serial)?.status).toBe(
        "revoked",
      );
    });

    it("is idempotent", async () => {
      const transport = new FakeTransport();
      const service = makeService(transport);
      const created = await service.createKey({ name: "x", scope: "read" });

      const first = await service.revokeKey(created.key.serial);
      const second = await service.revokeKey(created.key.serial);

      expect(first?.status).toBe("revoked");
      expect(second?.status).toBe("revoked");
    });

    it("returns null for an unknown serial", async () => {
      const service = makeService(new FakeTransport());

      await expect(service.revokeKey("nope")).resolves.toBeNull();
    });
  });

  describe("expired/revoked records", () => {
    it("still surfaces expired keys in list/get (rejection happens at auth time)", async () => {
      const transport = new FakeTransport();
      transport.seed({
        serial: "key_expired",
        name: "expired key",
        status: "active",
        expiresAt: PAST,
      });
      const service = makeService(transport);

      const read = await service.getKey("key_expired");
      expect(read?.expiresAt).toBe(PAST);

      const listed = await service.listKeys();
      expect(listed.map((k) => k.serial)).toContain("key_expired");
    });

    it("lists newest first across seeds and creates", async () => {
      const transport = new FakeTransport();
      transport.seed({ serial: "key_old", name: "old" });
      const service = makeService(transport);
      await service.createKey({ name: "new", scope: "read" });

      const listed = await service.listKeys();
      expect(listed.map((k) => k.serial)).toEqual(["key_1", "key_old"]);
    });
  });

  describe("environment resolution", () => {
    it("defaults to dev when no source is set", () => {
      expect(resolveApiKeyEnvironment({})).toBe("dev");
    });

    it("prefers API_KEY_ENV over NODE_ENV", () => {
      expect(
        resolveApiKeyEnvironment({ API_KEY_ENV: "prod", NODE_ENV: "development" }),
      ).toBe("prod");
    });

    it("falls back to NODE_ENV", () => {
      expect(resolveApiKeyEnvironment({ NODE_ENV: "production" })).toBe(
        "production",
      );
    });

    it("normalizes environment labels to [a-z0-9-]", () => {
      expect(resolveApiKeyEnvironment({ API_KEY_ENV: "Staging!" })).toBe(
        "staging",
      );
      expect(resolveApiKeyEnvironment({ API_KEY_ENV: "prod " })).toBe("prod");
    });

    it("keeps generated secrets aligned with the resolved environment", () => {
      expect(generateApiKeySecret("dev")).toMatch(/^waba_dev_[0-9a-f]{64}$/);
    });
  });
});
