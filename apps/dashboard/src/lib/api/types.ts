/**
 * Session API types for the dashboard's WABA client.
 *
 * Shapes mirror `services/api/src/adapters/http/app.ts` (`toSessionJson`) and
 * the domain status enums in `services/api/src/domain/session.ts`.
 */

import type { SyntheticWebhookPayload } from "./domain/webhook-test";

export type SessionStatus =
  | "created"
  | "pairing"
  | "connected"
  | "disconnected"
  | "logged_out";

/** `POST /api/v1/sessions` request payload. */
export interface CreateSessionInput {
  phone_number_id: string;
  number: string;
  display_phone?: string;
  business_account_id?: string;
}

/** A session as returned by the API (snake_case, `id` = serial). */
export interface Session {
  id: string;
  phone_number_id: string;
  number: string;
  display_phone: string | null;
  business_account_id: string | null;
  status: SessionStatus;
  whatsapp_id: string | null;
  connected_at: string | null;
  last_seen_at: string | null;
  logged_out_at: string | null;
  created_at: string;
}

/** `GET /api/v1/sessions/:serial/pairing/qr` QR status values. */
export type PairingQrStatus = "pending" | "ready" | "expired" | "not_found";

/** `jobs.status` values surfaced alongside a filtered QR response. */
export type PairingJobStatus = "pending" | "claimed" | "succeeded" | "failed" | "unknown";

/** Response of `GET /api/v1/sessions/:serial/pairing/qr`. */
export interface PairingQr {
  status: PairingQrStatus;
  qr_code: string | null;
  /** Serial of the QR row itself; null when no QR yet. */
  qr_serial: string | null;
  /** ISO timestamp; null when no QR row. */
  expires_at: string | null;
  /** Echoed back when `?job_serial=` was supplied. */
  job_serial?: string;
  /** Pairing job status; only set when filtered by `job_serial`. */
  job_status?: PairingJobStatus;
}

/** Accepted job responses (`POST pairing` / `POST logout`). */
export interface JobAccepted {
  job_serial: string;
}

/** `GET /api/v1/sessions/:serial/status` response. */
export interface SessionStatusResponse {
  status: SessionStatus;
}

/** `GET /api/v1/sessions` response envelope. */
export interface SessionsListResponse {
  sessions: Session[];
}

/**
 * Webhook config API types. Shapes mirror
 * `services/api/src/adapters/http/app.ts` (`toWebhookConfigJson`) and the
 * domain type in `src/lib/api/domain/webhook-config.ts`.
 */

/** `POST /api/v1/webhooks` request payload. */
export interface CreateWebhookInput {
  phone_number_id: string;
  webhook_url: string;
  webhook_secret?: string;
}

/** `PATCH /api/v1/webhooks/:serial` request payload (all fields optional). */
export interface UpdateWebhookInput {
  webhook_url?: string;
  webhook_secret?: string;
  enabled?: boolean;
  max_retries?: number;
  retry_delay_ms?: number;
  timeout_ms?: number;
}

/**
 * A webhook config as returned by the API (snake_case, `serial` = id). The
 * backend returns `webhook_secret` in plaintext; it is preserved as-is (not
 * masked or omitted).
 */
export interface WebhookConfig {
  id: number;
  serial: string;
  phone_number_id: string;
  webhook_url: string;
  webhook_secret: string | null;
  enabled: boolean;
  max_retries: number;
  retry_delay_ms: number;
  timeout_ms: number;
  created_at: string;
}

/** A webhook subscription as returned by the API (snake_case). */
export interface WebhookSubscription {
  id: number;
  serial: string;
  webhook_config_id: number;
  event_type: string;
  created_at: string;
}

/** `GET /api/v1/webhooks` response envelope. */
export interface WebhooksListResponse {
  webhooks: WebhookConfig[];
}

/** `GET /api/v1/webhooks/:serial/subscriptions` response envelope. */
export interface SubscriptionsListResponse {
  subscriptions: WebhookSubscription[];
}

/**
 * Failure codes for `POST /api/v1/webhooks/:serial/test` probes that never
 * produced an HTTP response (or whose target was rejected up front).
 */
export type WebhookTestErrorCode =
  | "blocked_target" // SSRF guard rejected a private/loopback/link-local/metadata address
  | "dns_failed" // target hostname did not resolve
  | "timeout" // endpoint did not respond within the bounded timeout
  | "network"; // connection / transport error

export interface WebhookTestError {
  code: WebhookTestErrorCode;
  message: string;
}

/**
 * Result of a single one-shot webhook test (snake_case wire shape from
 * `POST /api/v1/webhooks/:serial/test`). `outcome` is `"responded"` when the
 * endpoint returned any HTTP status (including non-2xx); `"failed"` covers
 * target rejection, DNS failure, timeout, and network errors.
 */
export interface WebhookTestResult {
  outcome: "responded" | "failed";
  /** `true` when the endpoint returned a 2xx status. */
  ok: boolean;
  /** HTTP status; null when the probe failed before/without a response. */
  status: number | null;
  status_text: string;
  headers: Record<string, string>;
  body: string | null;
  body_truncated: boolean;
  duration_ms: number;
  /** `true` when an X-Hub-Signature-256 header was attached to the request. */
  signature_sent: boolean;
  error: WebhookTestError | null;
  /** Echo of the exact synthetic payload that was sent. */
  payload: SyntheticWebhookPayload;
}

/** `POST /api/v1/webhooks/:serial/test` response envelope. */
export interface WebhookTestResponse {
  webhook_test: WebhookTestResult;
}

/**
 * API-key management types. Wire shapes mirror the route handlers in
 * `src/app/api/v1/api-keys/*` and the redacted management view
 * (`RedactedApiKey` in `src/lib/api/service/api-key-management.ts`).
 *
 * The plaintext key secret exists only in `CreateApiKeyResult`; list/get/
 * update/revoke responses are redacted and never include the secret (or its
 * SHA-256 hash).
 */

/** API-key scope: `read` covers GET API routes, `write` covers mutating routes, `full` grants both. */
export type ApiKeyScope = "read" | "write" | "full";

/** API-key lifecycle status as exposed by the management API. */
export type ApiKeyStatus = "active" | "revoked";

/** `POST /api/v1/api-keys` request payload. */
export interface CreateApiKeyInput {
  name: string;
  scope: ApiKeyScope;
  /** Null = key never expires. ISO timestamp when set. */
  expires_at?: string | null;
}

/** `PATCH /api/v1/api-keys/:serial` request payload (all fields optional). */
export interface UpdateApiKeyInput {
  name?: string;
  scope?: ApiKeyScope;
  /** Null clears the expiry. */
  expires_at?: string | null;
}

/**
 * A redacted API key as returned by the API (snake_case, `serial` = id). The
 * plaintext secret is never present; only the non-secret display `key_prefix`
 * (e.g. `waba_prod_…`) is exposed.
 */
export interface ApiKey {
  serial: string;
  name: string;
  key_prefix: string;
  scope: ApiKeyScope;
  status: ApiKeyStatus;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * `POST /api/v1/api-keys` response. The plaintext `secret` is returned exactly
 * once, only here, and can never be recovered afterwards.
 */
export interface CreateApiKeyResult {
  key: ApiKey;
  secret: string;
}

/** `GET /api/v1/api-keys` response envelope. */
export interface ApiKeysListResponse {
  api_keys: ApiKey[];
}

/** `GET /api/v1/api-keys/:serial/secret` response — the decrypted plaintext secret. */
export interface ApiKeySecretResponse {
  secret: string;
}

/** The WABA error envelope body: `{ error: { message, type, code } }`. */
export interface ApiErrorShape {
  error?: {
    message?: unknown;
    type?: unknown;
    code?: unknown;
    details?: unknown;
  };
}

/**
 * Normalized API error. `message` is human-readable; `code`/`details` come
 * from the WABA envelope when present; `isAuthError` is true for 401 or WABA
 * code 190 (invalid OAuth access token).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: number | null;
  readonly details: string | null;
  readonly isAuthError: boolean;

  constructor(
    status: number,
    message: string,
    code: number | null = null,
    details: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.isAuthError = status === 401 || code === 190;
  }
}
