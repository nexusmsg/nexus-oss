/**
 * Driven port: persistence access for API keys. The Drizzle adapter implements
 * it; the API-key management service and the async authorizer depend on it.
 *
 * Persisted keys store only a SHA-256 hex digest (`keyHash`) plus a non-secret
 * display prefix (`keyPrefix`); hashing and one-time plaintext handling live in
 * the service layer, never in this port.
 *
 * Soft-delete vs revoke semantics:
 * - `revokeKey` transitions `status` to `revoked`; the row stays visible to
 *   management (list/get) so operators can see what was revoked.
 * - Soft-deleted rows (`deleted_at` set) are treated as permanently gone:
 *   list/get/update/revoke/hash lookup all exclude them.
 */

import type {
  ApiKey,
  ApiKeyScope,
  CreateApiKeyInput as DomainCreateApiKeyInput,
} from "../domain/api-key";

/** Create input at the transport boundary: domain fields plus the derived key material. */
export interface CreateApiKeyInput extends DomainCreateApiKeyInput {
  /** Non-secret display prefix of the full key secret, e.g. `waba_prod_…`. */
  keyPrefix: string;
  /** SHA-256 hex digest of the full key secret. Never the plaintext. */
  keyHash: string;
}

/** Partial update: only present fields are written. `expiresAt: null` clears expiry. */
export interface UpdateApiKeyInput {
  name?: string;
  scope?: ApiKeyScope;
  expiresAt?: string | null;
}

export interface ApiKeyTransport {
  /** INSERT an API key with precomputed prefix/hash; returns the persisted row. */
  createKey(input: CreateApiKeyInput): Promise<ApiKey>;
  /** Fetch all non-deleted keys (active and revoked), newest first. */
  listKeys(): Promise<ApiKey[]>;
  /** Fetch a non-deleted key by serial; null when absent. */
  getKey(serial: string): Promise<ApiKey | null>;
  /**
   * Fetch a non-deleted key by SHA-256 hash. Revoked rows are returned so the
   * authorizer can reject them; soft-deleted rows resolve to null.
   */
  getKeyByHash(keyHash: string): Promise<ApiKey | null>;
  /**
   * Apply a partial update to a non-deleted key; null when the key is absent
   * or soft-deleted. Does not change `status` (see `revokeKey`).
   */
  updateKey(serial: string, input: UpdateApiKeyInput): Promise<ApiKey | null>;
  /** Set a non-deleted key's status to `revoked`; null when absent/soft-deleted. Idempotent. */
  revokeKey(serial: string): Promise<ApiKey | null>;
  /**
   * Best-effort, throttled `last_used_at` update after a successful
   * persisted-key authentication (API-5b): writes at most once per key per
   * five minutes and never for revoked, expired, or soft-deleted keys.
   * Resolves without effect when the throttle or lifecycle conditions are not
   * met. Callers treat this as non-blocking and must ensure rejections never
   * escape.
   */
  touchKeyLastUsed(serial: string): Promise<void>;
}
