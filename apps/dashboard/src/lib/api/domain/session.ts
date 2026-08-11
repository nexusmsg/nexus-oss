/**
 * WhatsApp device session domain types. Pure domain: no Hono, Supabase, or
 * node imports. Mirrors the `sessions` and `session_qr_codes` tables
 * (migration 000003).
 */

export type SessionStatus =
  | "created"
  | "pairing"
  | "connected"
  | "disconnected"
  | "logged_out";

export type QrCodeStatus = "pending" | "ready" | "expired";

export interface Session {
  /** Numeric primary key (sessions.id) used as the FK on session_qr_codes. */
  id: number;
  serial: string;
  phoneNumberId: string;
  number: string;
  displayPhone: string;
  businessAccountId: string;
  status: SessionStatus;
  whatsappId: string | null;
  connectedAt: string | null;
  lastSeenAt: string | null;
  loggedOutAt: string | null;
  createdAt: string;
}

export interface SessionQrCode {
  serial: string;
  sessionId: number;
  phoneNumberId: string;
  qrCode: string;
  status: QrCodeStatus;
  expiresAt: string;
  /** Serial of the pairing job that produced this QR; null for legacy rows. */
  jobSerial: string | null;
  createdAt: string;
}

export interface CreateSessionInput {
  phoneNumberId: string;
  number: string;
  displayPhone?: string;
  businessAccountId?: string;
}
