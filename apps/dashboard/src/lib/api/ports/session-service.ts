/**
 * Application-facing port for session operations. The HTTP adapter depends on
 * this; `SessionService` implements it. Null returns mean the session does not
 * exist (mapped to 404 by the HTTP adapter).
 */

import type { CreateSessionInput, Session } from "../domain/session";

/** Pairing-job status values, mirroring the `jobs.status` column. */
export type JobStatus =
  | "pending"
  | "claimed"
  | "succeeded"
  | "failed";

/** Options for `getPairingQr`. */
export interface PairingQrOptions {
  /** When set, return the QR row produced by this pairing job (not the latest). */
  jobSerial?: string;
}

export interface PairingQrResult {
  /** Status of the QR row: pending | ready | expired | not_found. */
  status: string;
  qrCode: string | null;
  /** Serial of the QR row itself (always surfaced, null when no QR yet). */
  qrSerial: string | null;
  /** ISO timestamp; null when no QR row. */
  expiresAt: string | null;
  /** Echoed back when the call was filtered by `jobSerial`. */
  jobSerial?: string;
  /** Status of the pairing job; only set when filtered by `jobSerial`. */
  jobStatus?: JobStatus | "unknown";
}

export interface SessionServicePort {
  createSession(input: CreateSessionInput): Promise<Session>;
  getSession(serial: string): Promise<Session | null>;
  listSessions(): Promise<Session[]>;
  startPairing(serial: string): Promise<{ jobSerial: string } | null>;
  getPairingQr(
    serial: string,
    options?: PairingQrOptions,
  ): Promise<PairingQrResult | null>;
  startLogout(serial: string): Promise<{ jobSerial: string } | null>;
  getStatus(serial: string): Promise<{ status: string } | null>;
  heartbeat(phoneNumberId: string): Promise<void>;
  deleteSession(serial: string): Promise<boolean>;
}
