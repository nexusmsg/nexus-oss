/* ── API keys API ──
 *
 * Typed functions for the `/api/v1/api-keys*` management routes served by
 * `apps/dashboard` (Next.js route handlers). All errors surface as `ApiError`
 * with the WABA envelope normalized by the client.
 *
 * Redaction contract: the plaintext secret is returned only by `createApiKey`
 * (one-time). `listApiKeys`, `getApiKey`, `updateApiKey`, and `revokeApiKey`
 * return redacted records and never include the secret.
 */

import { apiDelete, apiGet, apiPatch, apiPost } from "./client";
import type {
  ApiKey,
  ApiKeysListResponse,
  CreateApiKeyInput,
  CreateApiKeyResult,
  UpdateApiKeyInput,
} from "./types";

export async function listApiKeys(): Promise<ApiKey[]> {
  const res = await apiGet<ApiKeysListResponse>("/api/v1/api-keys");
  return res.api_keys;
}

/** Create a key. The plaintext `secret` is returned exactly once, here only. */
export async function createApiKey(
  input: CreateApiKeyInput,
): Promise<CreateApiKeyResult> {
  return apiPost<CreateApiKeyResult>("/api/v1/api-keys", input);
}

export async function getApiKey(serial: string): Promise<ApiKey> {
  return apiGet<ApiKey>(`/api/v1/api-keys/${encodeURIComponent(serial)}`);
}

export async function updateApiKey(
  serial: string,
  input: UpdateApiKeyInput,
): Promise<ApiKey> {
  return apiPatch<ApiKey>(
    `/api/v1/api-keys/${encodeURIComponent(serial)}`,
    input,
  );
}

/** Revoke a key. Idempotent; the key stays visible in list/get afterwards. */
export async function revokeApiKey(serial: string): Promise<void> {
  await apiDelete(`/api/v1/api-keys/${encodeURIComponent(serial)}`);
}
