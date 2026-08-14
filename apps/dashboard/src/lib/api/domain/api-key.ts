/**
 * API-key domain types. Pure domain: no Next.js, Drizzle, or node imports.
 * Mirrors the `api_keys` table (migration 000011).
 *
 * Persisted keys are real additive Bearer credentials for the dashboard API.
 * Only a SHA-256 hex digest of the full secret (`keyHash`) and a non-secret
 * display prefix (`keyPrefix`) are stored; the plaintext secret is returned
 * exactly once at creation and never persisted, logged, or recoverable.
 *
 * `keyCiphertext` is a nullable AES-256-GCM envelope of the full secret that
 * enables on-demand reveal. NULL = a pre-migration key whose plaintext was
 * never persisted and therefore cannot be recovered. `keyHash` stays the
 * authentication lookup; the ciphertext is strictly additive storage.
 */

export type ApiKeyScope = "read" | "write" | "full";

export type ApiKeyStatus = "active" | "revoked";

export interface ApiKey {
  serial: string;
  name: string;
  /** Non-secret display prefix, e.g. `waba_prod_…`; safe to show in lists. */
  keyPrefix: string;
  /** SHA-256 hex digest of the full key secret. Never returned. */
  keyHash: string;
  /**
   * AES-256-GCM envelope of the full key secret; enables on-demand reveal.
   * Null = pre-migration key whose plaintext was never persisted.
   */
  keyCiphertext: string | null;
  scope: ApiKeyScope;
  status: ApiKeyStatus;
  /** Null = key never expires. */
  expiresAt: string | null;
  /** Null = key has never successfully authenticated. */
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Null = key is live; non-null = soft-deleted. */
  deletedAt: string | null;
}

export interface CreateApiKeyInput {
  name: string;
  scope: ApiKeyScope;
  /** Null = key never expires. */
  expiresAt?: string | null;
}

/**
 * Throttle window for the best-effort `last_used_at` update that follows a
 * successful persisted-key authentication: at most one update per key per
 * five minutes (API-5b). Enforced by the authorizer and mirrored by the
 * Drizzle adapter's conditional UPDATE so concurrent requests cannot bypass it.
 */
export const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;
