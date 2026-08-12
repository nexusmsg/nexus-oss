/**
 * Application service implementing API-key management. Owns secure key
 * generation, hashing, and one-time plaintext return; delegates persistence to
 * the driven `ApiKeyTransport` port. Imports only domain + ports.
 *
 * Security contract (plan: key format is `waba_<environment>_<random-secret>`):
 * - The secret is `randomBytes(32)` (256 bits) hex-encoded, produced with
 *   `node:crypto`'s CSPRNG. The full secret is `waba_<env>_<64 hex chars>`.
 * - Only a SHA-256 hex digest of the full secret (`keyHash`) and a non-secret
 *   display prefix (`keyPrefix`) are persisted. The plaintext secret is
 *   returned exactly once, only from `createKey`, and is never stored, logged,
 *   or recoverable.
 * - Reads (`getKey`, `listKeys`, `updateKey`, `revokeKey`) return redacted
 *   records that omit `keyHash` (and `deletedAt`).
 *
 * Environment source: the prefix's `<environment>` segment comes from
 * `API_KEY_ENV`, falling back to `NODE_ENV`, falling back to `"dev"`. The value
 * is normalized to `[a-z0-9-]` so it is always safe inside a key prefix.
 */

import { createHash, randomBytes } from "node:crypto";
import type {
  ApiKey,
  ApiKeyScope,
  ApiKeyStatus,
  CreateApiKeyInput,
} from "../domain/api-key";
import { ValidationError } from "../domain/errors";
import type {
  ApiKeyTransport,
  UpdateApiKeyInput,
} from "../ports/api-key-transport";

/** Key-prefix environment source; falls back to `NODE_ENV`, then `"dev"`. */
const ENVIRONMENT_VAR = "API_KEY_ENV";
const FALLBACK_ENVIRONMENT_VAR = "NODE_ENV";
const DEFAULT_ENVIRONMENT = "dev";

/** Minimum random-secret entropy per the plan: 32 random bytes. */
const RANDOM_SECRET_BYTES = 32;

/** Cap on key display names; keeps the UI table and any downstream text sane. */
const MAX_NAME_LENGTH = 200;

const API_KEY_SCOPES = ["read", "write", "full"] as const;

/** Application-facing port for API-key management (HTTP adapter depends on this). */
export interface ApiKeyManagementServicePort {
  /**
   * Create a key. Returns the redacted persisted record plus the plaintext
   * secret. The secret is returned only from this method, exactly once.
   */
  createKey(input: CreateApiKeyInput): Promise<CreateApiKeyResult>;
  /** Redacted record for a non-deleted key; null when absent. */
  getKey(serial: string): Promise<RedactedApiKey | null>;
  /** Redacted records for all non-deleted keys, newest first. */
  listKeys(): Promise<RedactedApiKey[]>;
  /** Partial update of name/scope/expiry; null when the key is absent. */
  updateKey(
    serial: string,
    input: UpdateApiKeyInput,
  ): Promise<RedactedApiKey | null>;
  /** Transition a key to `revoked`; null when absent. Idempotent. */
  revokeKey(serial: string): Promise<RedactedApiKey | null>;
}

/** Result of `createKey`: the persisted record plus the one-time plaintext. */
export interface CreateApiKeyResult {
  /** Redacted persisted record — never contains the secret or its hash. */
  key: RedactedApiKey;
  /** Plaintext key secret, returned exactly once at creation. Never stored or logged. */
  secret: string;
}

/**
 * Redacted management view of an API key. Omits `keyHash` (derived from the
 * secret) and `deletedAt`; keeps the non-secret display `keyPrefix`.
 */
export interface RedactedApiKey {
  serial: string;
  name: string;
  keyPrefix: string;
  scope: ApiKeyScope;
  status: ApiKeyStatus;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKeyManagementServiceOptions {
  /**
   * Environment label embedded in generated key prefixes (`waba_<env>_…`).
   * When omitted, resolved from `API_KEY_ENV` → `NODE_ENV` → `"dev"`.
   */
  environment?: string;
}

export class ApiKeyManagementService implements ApiKeyManagementServicePort {
  private readonly transport: ApiKeyTransport;
  private readonly environment: string;

  constructor(
    transport: ApiKeyTransport,
    options: ApiKeyManagementServiceOptions = {},
  ) {
    this.transport = transport;
    this.environment =
      options.environment !== undefined
        ? sanitizeApiKeyEnvironment(options.environment)
        : resolveApiKeyEnvironment();
  }

  async createKey(input: CreateApiKeyInput): Promise<CreateApiKeyResult> {
    const validated = validateCreateApiKeyInput(input);

    const secret = generateApiKeySecret(this.environment);
    const key = await this.transport.createKey({
      name: validated.name,
      scope: validated.scope,
      expiresAt: validated.expiresAt ?? null,
      keyPrefix: apiKeyPrefix(this.environment),
      keyHash: hashApiKeySecret(secret),
    });

    return { key: redactApiKey(key), secret };
  }

  async getKey(serial: string): Promise<RedactedApiKey | null> {
    const key = await this.transport.getKey(serial);
    return key === null ? null : redactApiKey(key);
  }

  async listKeys(): Promise<RedactedApiKey[]> {
    const keys = await this.transport.listKeys();
    return keys.map(redactApiKey);
  }

  async updateKey(
    serial: string,
    input: UpdateApiKeyInput,
  ): Promise<RedactedApiKey | null> {
    const key = await this.transport.getKey(serial);
    if (key === null) {
      return null;
    }
    const validated = validateUpdateApiKeyInput(input);
    const updated = await this.transport.updateKey(serial, validated);
    return updated === null ? null : redactApiKey(updated);
  }

  async revokeKey(serial: string): Promise<RedactedApiKey | null> {
    const revoked = await this.transport.revokeKey(serial);
    return revoked === null ? null : redactApiKey(revoked);
  }
}

/**
 * Generate a full key secret: `waba_<environment>_<random-secret>` where the
 * random secret is at least 32 CSPRNG bytes, hex-encoded.
 */
export function generateApiKeySecret(environment: string): string {
  const randomPart = randomBytes(RANDOM_SECRET_BYTES).toString("hex");
  return `${apiKeyPrefix(environment)}${randomPart}`;
}

/** Non-secret display prefix (`waba_<environment>_`), safe to show in lists. */
export function apiKeyPrefix(environment: string): string {
  return `waba_${environment}_`;
}

/** SHA-256 hex digest of the full key secret. Never the plaintext. */
export function hashApiKeySecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/**
 * Resolve the key-prefix environment: `API_KEY_ENV` → `NODE_ENV` → `"dev"`.
 * The explicit env parameter keeps this deterministic under test.
 */
export function resolveApiKeyEnvironment(
  env: Record<string, string | undefined> = process.env,
): string {
  const raw = env[ENVIRONMENT_VAR] ?? env[FALLBACK_ENVIRONMENT_VAR];
  return sanitizeApiKeyEnvironment(raw ?? DEFAULT_ENVIRONMENT);
}

/** Normalize an environment label to `[a-z0-9-]`; empty falls back to `"dev"`. */
export function sanitizeApiKeyEnvironment(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned === "" ? DEFAULT_ENVIRONMENT : cleaned;
}

function validateCreateApiKeyInput(input: CreateApiKeyInput): CreateApiKeyInput {
  validateName(input.name);
  validateScope(input.scope);
  if (input.expiresAt !== undefined && input.expiresAt !== null) {
    validateExpiry(input.expiresAt);
  }
  return input;
}

function validateUpdateApiKeyInput(input: UpdateApiKeyInput): UpdateApiKeyInput {
  const hasAnyField =
    input.name !== undefined ||
    input.scope !== undefined ||
    input.expiresAt !== undefined;
  if (!hasAnyField) {
    throw new ValidationError("no fields to update");
  }
  if (input.name !== undefined) {
    validateName(input.name);
  }
  if (input.scope !== undefined) {
    validateScope(input.scope);
  }
  // `expiresAt: null` clears expiry and needs no validation.
  if (input.expiresAt !== undefined && input.expiresAt !== null) {
    validateExpiry(input.expiresAt);
  }
  return input;
}

function validateName(name: string): void {
  if (typeof name !== "string" || name.trim() === "") {
    throw new ValidationError("name is required");
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new ValidationError(
      `name must be at most ${MAX_NAME_LENGTH} characters`,
    );
  }
}

function validateScope(scope: ApiKeyScope): void {
  if (!API_KEY_SCOPES.includes(scope)) {
    throw new ValidationError("scope must be one of: read, write, full");
  }
}

function validateExpiry(expiresAt: string): void {
  const time = Date.parse(expiresAt);
  if (!Number.isFinite(time)) {
    throw new ValidationError("expires_at must be a valid date");
  }
  if (time <= Date.now()) {
    throw new ValidationError("expires_at must be in the future");
  }
}

/** Strip the secret material and lifecycle noise from a persisted row. */
function redactApiKey(key: ApiKey): RedactedApiKey {
  return {
    serial: key.serial,
    name: key.name,
    keyPrefix: key.keyPrefix,
    scope: key.scope,
    status: key.status,
    expiresAt: key.expiresAt,
    lastUsedAt: key.lastUsedAt,
    createdAt: key.createdAt,
    updatedAt: key.updatedAt,
  };
}

/** Compile-time assertion (Go convention): service implements the app port. */
const _: ApiKeyManagementServicePort =
  undefined as unknown as ApiKeyManagementService;
