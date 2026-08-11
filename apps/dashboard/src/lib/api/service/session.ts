/**
 * Application service implementing SessionServicePort: thin delegation to the
 * driven SessionTransport port plus input validation. Imports only domain +
 * ports.
 */

import type { CreateSessionInput, Session } from "../domain/session";
import { ValidationError } from "../domain/errors";
import type { JobTransport } from "../ports/job-transport";
import type {
  PairingQrOptions,
  PairingQrResult,
  SessionServicePort,
} from "../ports/session-service";
import type { SessionTransport } from "../ports/session-transport";

export class SessionService implements SessionServicePort {
  private readonly transport: SessionTransport;
  // Used to look up the originating pairing job's status when getPairingQr is
  // filtered by job_serial. Same DrizzleTransport instance implements both
  // ports, passed in by compose().
  private readonly jobs: JobTransport;

  constructor(transport: SessionTransport, jobs: JobTransport) {
    this.transport = transport;
    this.jobs = jobs;
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
    const jobSerial = await this.transport.createPairingJob(session.phoneNumberId);
    return { jobSerial };
  }

  async getPairingQr(
    serial: string,
    options?: PairingQrOptions,
  ): Promise<PairingQrResult | null> {
    const session = await this.transport.getSession(serial);
    if (session === null) {
      return null;
    }

    const jobSerial = options?.jobSerial;
    const qr =
      jobSerial !== undefined
        ? await this.transport.getQrCodeByJobSerial(jobSerial)
        : await this.transport.getLatestQrCode(session.id);

    const base: PairingQrResult =
      qr === null
        ? { status: "not_found", qrCode: null, qrSerial: null, expiresAt: null }
        : {
            status: qr.status,
            qrCode: qr.qrCode,
            qrSerial: qr.serial,
            expiresAt: qr.expiresAt,
          };

    if (jobSerial === undefined) {
      return base;
    }

    // Filtered call: also surface the originating job's status so the client
    // can distinguish "still pending" (worker hasn't finished) from "ready"
    // (worker wrote the QR) and from "failed" (terminal error).
    const job = await this.jobs.poll(jobSerial);
    return {
      ...base,
      jobSerial,
      jobStatus: job?.status === "pending" ||
        job?.status === "claimed" ||
        job?.status === "succeeded" ||
        job?.status === "failed"
        ? job.status
        : "unknown",
    };
  }

  async startLogout(serial: string): Promise<{ jobSerial: string } | null> {
    const session = await this.transport.getSession(serial);
    if (session === null) {
      return null;
    }
    const jobSerial = await this.transport.createLogoutJob(session.phoneNumberId);
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
