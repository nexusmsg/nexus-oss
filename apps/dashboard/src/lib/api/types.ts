/**
 * Session API types for the dashboard's WABA client.
 *
 * Shapes mirror `services/api/src/adapters/http/app.ts` (`toSessionJson`) and
 * the domain status enums in `services/api/src/domain/session.ts`.
 */

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
