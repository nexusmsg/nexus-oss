/**
 * Application-facing port for session operations. The HTTP adapter depends on
 * this; `SessionService` implements it. Null returns mean the session does not
 * exist (mapped to 404 by the HTTP adapter).
 */

import type { CreateSessionInput, Session } from "../domain/session.js";

export interface PairingQrResult {
  status: string;
  qrCode: string | null;
}

export interface SessionServicePort {
  createSession(input: CreateSessionInput): Promise<Session>;
  getSession(serial: string): Promise<Session | null>;
  listSessions(): Promise<Session[]>;
  startPairing(serial: string): Promise<{ jobSerial: string } | null>;
  getPairingQr(serial: string): Promise<PairingQrResult | null>;
  startLogout(serial: string): Promise<{ jobSerial: string } | null>;
  getStatus(serial: string): Promise<{ status: string } | null>;
  heartbeat(phoneNumberId: string): Promise<void>;
}
