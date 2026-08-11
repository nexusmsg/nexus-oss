/* ── Sessions API ──
 *
 * Typed functions for the `/api/v1/sessions*` routes served by
 * `services/api/src/adapters/http/app.ts`. All errors surface as `ApiError`
 * with the WABA envelope normalized by the client.
 */

import { apiGet, apiPost } from "./client";
import type {
  CreateSessionInput,
  JobAccepted,
  PairingQr,
  Session,
  SessionStatus,
  SessionStatusResponse,
  SessionsListResponse,
} from "./types";

export async function listSessions(): Promise<Session[]> {
  const res = await apiGet<SessionsListResponse>("/api/v1/sessions");
  return res.sessions;
}

export async function createSession(input: CreateSessionInput): Promise<Session> {
  return apiPost<Session>("/api/v1/sessions", input);
}

export async function requestPairing(serial: string): Promise<JobAccepted> {
  return apiPost<JobAccepted>(`/api/v1/sessions/${encodeURIComponent(serial)}/pairing`);
}

/**
 * Fetches the pairing QR for a session. Pass `jobSerial` to scope the
 * response to the QR produced by a specific pairing job — without it, the
 * endpoint returns the most recent QR for the session (legacy behavior).
 */
export async function getPairingQr(
  serial: string,
  options?: { jobSerial?: string; init?: RequestInit },
): Promise<PairingQr> {
  const params = options?.jobSerial
    ? `?job_serial=${encodeURIComponent(options.jobSerial)}`
    : "";
  return apiGet<PairingQr>(
    `/api/v1/sessions/${encodeURIComponent(serial)}/pairing/qr${params}`,
    options?.init,
  );
}

export async function logout(serial: string): Promise<JobAccepted> {
  return apiPost<JobAccepted>(`/api/v1/sessions/${encodeURIComponent(serial)}/logout`);
}

export async function getSessionStatus(
  serial: string,
  init?: RequestInit,
): Promise<SessionStatus> {
  const res = await apiGet<SessionStatusResponse>(
    `/api/v1/sessions/${encodeURIComponent(serial)}/status`,
    init,
  );
  return res.status;
}
