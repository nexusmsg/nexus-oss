/**
 * API-key domain types. Pure domain: no Next.js, Drizzle, or node imports.
 * Mirrors the `api_keys` table (migration 000011).
 *
 * Persisted keys are real additive Bearer credentials for the dashboard API.
 * Only a SHA-256 hex digest of the full secret (`keyHash`) and a non-secret
 * display prefix (`keyPrefix`) are stored; the plaintext secret is returned
 * exactly once at creation and never persisted, logged, or recoverable.
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
