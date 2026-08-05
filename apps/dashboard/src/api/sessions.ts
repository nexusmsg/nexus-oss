import { apiFetch } from "./client";

// ── Session types ──

export type SessionStatus =
  | "created"
  | "pairing"
  | "connected"
  | "disconnected"
  | "logged_out";

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

export interface PairingJob {
  job_serial: string;
}

export type QrStatus = "pending" | "ready" | "expired" | "not_found";

export interface QrResponse {
  status: QrStatus;
  qr_code: string | null;
}

// ── Session API functions ──

export function listSessions(): Promise<{ sessions: Session[] }> {
  return apiFetch("/api/v1/sessions");
}

export function getSession(serial: string): Promise<Session> {
  return apiFetch(`/api/v1/sessions/${serial}`);
}

export function createSession(data: {
  phone_number_id: string;
  number: string;
  business_account_id?: string;
}): Promise<Session> {
  return apiFetch("/api/v1/sessions", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function startPairing(serial: string): Promise<PairingJob> {
  return apiFetch(`/api/v1/sessions/${serial}/pairing`, {
    method: "POST",
  });
}

export function getPairingQr(serial: string): Promise<QrResponse> {
  return apiFetch(`/api/v1/sessions/${serial}/pairing/qr`);
}

export function logoutSession(serial: string): Promise<void> {
  return apiFetch(`/api/v1/sessions/${serial}/logout`, {
    method: "POST",
  });
}

export function getStatus(serial: string): Promise<Session> {
  return apiFetch(`/api/v1/sessions/${serial}/status`);
}
