/**
 * Application service implementing SessionServicePort: thin delegation to the
 * driven SessionTransport port plus input validation. Imports only domain +
 * ports.
 */

import type { CreateSessionInput, Session } from "../domain/session.js";
import { ValidationError } from "../domain/errors.js";
import type { SessionServicePort } from "../ports/session-service.js";
import type { SessionTransport } from "../ports/session-transport.js";

export class SessionService implements SessionServicePort {
  private readonly transport: SessionTransport;

  constructor(transport: SessionTransport) {
    this.transport = transport;
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    const serial = await this.transport.createSession(validateCreateSession(input));
    const session = await this.transport.getSession(serial);
    if (session === null) {
      throw new Error("create session: created row not found");
    }
    return session;
  }

  async getSession(serial: string): Promise<Session | null> {
    return this.transport.getSession(serial);
  }

  async listSessions(): Promise<Session[]> {
    return this.transport.listSessions();
  }

  async startPairing(serial: string): Promise<{ jobSerial: string } | null> {
    const session = await this.transport.getSession(serial);
    if (session === null) {
      return null;
    }
    // The transport maps serial → numeric id for the FK on session_qr_codes.
    const jobSerial = await this.transport.createPairingJob(
      session.id,
      session.phoneNumberId,
    );
    return { jobSerial };
  }

  async getPairingQr(serial: string): Promise<{ status: string; qrCode: string | null } | null> {
    const session = await this.transport.getSession(serial);
    if (session === null) {
      return null;
    }
    const qr = await this.transport.getLatestQrCode(session.id);
    if (qr === null) {
      return { status: "not_found", qrCode: null };
    }
    return { status: qr.status, qrCode: qr.qrCode };
  }

  async startLogout(serial: string): Promise<{ jobSerial: string } | null> {
    const session = await this.transport.getSession(serial);
    if (session === null) {
      return null;
    }
    const jobSerial = await this.transport.createLogoutJob(
      session.id,
      session.phoneNumberId,
    );
    return { jobSerial };
  }

  async getStatus(serial: string): Promise<{ status: string } | null> {
    const session = await this.transport.getSession(serial);
    return session === null ? null : { status: session.status };
  }

  async heartbeat(phoneNumberId: string): Promise<void> {
    if (!isNonEmptyString(phoneNumberId)) {
      throw new ValidationError("phone_number_id is required");
    }
    await this.transport.updateSessionHeartbeat(phoneNumberId);
  }
}

function validateCreateSession(input: CreateSessionInput): CreateSessionInput {
  if (!isNonEmptyString(input.phoneNumberId)) {
    throw new ValidationError("phone_number_id is required");
  }
  if (!isNonEmptyString(input.number)) {
    throw new ValidationError("number is required");
  }
  return input;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** Compile-time assertion (Go convention): SessionService implements SessionServicePort. */
const _: SessionServicePort = undefined as unknown as SessionService;
