/**
 * Driven port: persistence access for sessions and session QR codes. The
 * Supabase adapter implements it; the application layer (services) depends on
 * it.
 */

import type { CreateSessionInput, Session, SessionQrCode } from "../domain/session";

export interface SessionTransport {
  /** INSERT a session; returns its `serial`. Idempotent on phone_number_id. */
  createSession(input: CreateSessionInput): Promise<string>;
  /** Fetch a session by serial (ignores soft-deleted rows); null when absent. */
  getSession(serial: string): Promise<Session | null>;
  /** Fetch all non-deleted sessions, newest first. */
  listSessions(): Promise<Session[]>;
  /** Set a session's status by serial. */
  updateSessionStatus(serial: string, status: string): Promise<void>;
  /** INSERT a pairing job; returns its `serial`. */
  createPairingJob(phoneNumberId: string): Promise<string>;
  /** INSERT a logout job; returns its `serial`. */
  createLogoutJob(phoneNumberId: string): Promise<string>;
  /** Fetch the most recent QR code for a session; null when absent. */
  getLatestQrCode(sessionId: number): Promise<SessionQrCode | null>;
  /** INSERT a QR code row for a session. */
  storeQrCode(sessionId: number, phoneNumberId: string, qrCode: string, expiresAt: Date): Promise<void>;
  /** Touch last_seen_at for a session by phone_number_id. */
  updateSessionHeartbeat(phoneNumberId: string): Promise<void>;
  /** Fetch a session by phone_number_id; null when absent. */
  getSessionByPhoneNumberId(phoneNumberId: string): Promise<Session | null>;
}
