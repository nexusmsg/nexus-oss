import { describe, expect, it } from "vitest";
import { ValidationError } from "../domain/errors.js";
import type { CreateSessionInput, Session, SessionQrCode } from "../domain/session.js";
import type { SessionTransport } from "../ports/session-transport.js";
import { SessionService } from "./session.js";

const SAMPLE_SESSION: Session = {
  id: 1,
  serial: "session-serial-1",
  phoneNumberId: "12345",
  number: "62812345678",
  displayPhone: "62812345678",
  status: "connected",
  whatsappId: "whatsapp-id-1",
  connectedAt: "2026-01-01T00:00:00Z",
  lastSeenAt: "2026-01-01T00:00:00Z",
  loggedOutAt: null,
  createdAt: "2026-01-01T00:00:00Z",
};

class FakeSessionTransport implements SessionTransport {
  sessions: Session[] = [];
  createCalls: CreateSessionInput[] = [];
  heartbeatCalls: string[] = [];
  pairingJobs: { sessionId: number; phoneNumberId: string }[] = [];
  logoutJobs: { sessionId: number; phoneNumberId: string }[] = [];
  latestQr: SessionQrCode | null = null;
  createdSerial = "session-serial-1";
  createReturnsNullSerial = false;

  async createSession(input: CreateSessionInput): Promise<string> {
    this.createCalls.push(input);
    return this.createReturnsNullSerial ? "" : this.createdSerial;
  }

  async getSession(serial: string): Promise<Session | null> {
    return this.sessions.find((s) => s.serial === serial) ?? null;
  }

  async listSessions(): Promise<Session[]> {
    return this.sessions;
  }

  async updateSessionStatus(_serial: string, _status: string): Promise<void> {}

  async createPairingJob(sessionId: number, phoneNumberId: string): Promise<string> {
    this.pairingJobs.push({ sessionId, phoneNumberId });
    return "pairing-job-1";
  }

  async createLogoutJob(sessionId: number, phoneNumberId: string): Promise<string> {
    this.logoutJobs.push({ sessionId, phoneNumberId });
    return "logout-job-1";
  }

  async getLatestQrCode(_sessionId: number): Promise<SessionQrCode | null> {
    return this.latestQr;
  }

  async storeQrCode(
    _sessionId: number,
    _phoneNumberId: string,
    _qrCode: string,
    _expiresAt: Date,
  ): Promise<void> {}

  async updateSessionHeartbeat(phoneNumberId: string): Promise<void> {
    this.heartbeatCalls.push(phoneNumberId);
  }

  async getSessionByPhoneNumberId(phoneNumberId: string): Promise<Session | null> {
    return this.sessions.find((s) => s.phoneNumberId === phoneNumberId) ?? null;
  }
}

function makeService(transport: SessionTransport = new FakeSessionTransport()): SessionService {
  return new SessionService(transport);
}

const VALID_INPUT: CreateSessionInput = {
  phoneNumberId: "12345",
  number: "62812345678",
  displayPhone: "62812345678",
};

describe("SessionService.createSession", () => {
  it("returns the created session for valid input", async () => {
    const transport = new FakeSessionTransport();
    transport.sessions = [SAMPLE_SESSION];
    const service = makeService(transport);

    await expect(service.createSession(VALID_INPUT)).resolves.toEqual(SAMPLE_SESSION);
    expect(transport.createCalls).toEqual([VALID_INPUT]);
  });

  it("throws ValidationError when phone_number_id is missing", async () => {
    const service = makeService();

    await expect(service.createSession({ ...VALID_INPUT, phoneNumberId: "" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(service.createSession({ ...VALID_INPUT, phoneNumberId: "" })).rejects.toThrow(
      "phone_number_id is required",
    );
  });

  it("throws ValidationError when number is missing", async () => {
    const service = makeService();

    await expect(service.createSession({ ...VALID_INPUT, number: "   " })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(service.createSession({ ...VALID_INPUT, number: "   " })).rejects.toThrow(
      "number is required",
    );
  });

  it("throws when the transport returns null after create", async () => {
    const transport = new FakeSessionTransport();
    const service = makeService(transport);

    await expect(service.createSession(VALID_INPUT)).rejects.toThrow(
      "create session: created row not found",
    );
  });
});

describe("SessionService.getSession", () => {
  it("returns the session when it exists", async () => {
    const transport = new FakeSessionTransport();
    transport.sessions = [SAMPLE_SESSION];
    const service = makeService(transport);

    await expect(service.getSession("session-serial-1")).resolves.toEqual(SAMPLE_SESSION);
  });

  it("returns null when the session is missing", async () => {
    const service = makeService();

    await expect(service.getSession("nope")).resolves.toBeNull();
  });
});

describe("SessionService.listSessions", () => {
  it("returns the array of sessions", async () => {
    const transport = new FakeSessionTransport();
    transport.sessions = [SAMPLE_SESSION];
    const service = makeService(transport);

    await expect(service.listSessions()).resolves.toEqual([SAMPLE_SESSION]);
  });
});

describe("SessionService.startPairing", () => {
  it("returns a jobSerial for an existing session", async () => {
    const transport = new FakeSessionTransport();
    transport.sessions = [SAMPLE_SESSION];
    const service = makeService(transport);

    await expect(service.startPairing("session-serial-1")).resolves.toEqual({
      jobSerial: "pairing-job-1",
    });
    expect(transport.pairingJobs).toEqual([{ sessionId: 1, phoneNumberId: "12345" }]);
  });

  it("returns null when the session is missing", async () => {
    const service = makeService();

    await expect(service.startPairing("nope")).resolves.toBeNull();
  });
});

describe("SessionService.getPairingQr", () => {
  it("returns not_found when no QR exists", async () => {
    const transport = new FakeSessionTransport();
    transport.sessions = [SAMPLE_SESSION];
    const service = makeService(transport);

    await expect(service.getPairingQr("session-serial-1")).resolves.toEqual({
      status: "not_found",
      qrCode: null,
    });
  });

  it("returns the status and qrCode when the QR is ready", async () => {
    const transport = new FakeSessionTransport();
    transport.sessions = [SAMPLE_SESSION];
    transport.latestQr = {
      serial: "qr-1",
      sessionId: 1,
      phoneNumberId: "12345",
      qrCode: "qr-data",
      status: "ready",
      expiresAt: "2026-01-01T00:00:00Z",
      createdAt: "2026-01-01T00:00:00Z",
    };
    const service = makeService(transport);

    await expect(service.getPairingQr("session-serial-1")).resolves.toEqual({
      status: "ready",
      qrCode: "qr-data",
    });
  });

  it("returns an expired status when the QR is expired", async () => {
    const transport = new FakeSessionTransport();
    transport.sessions = [SAMPLE_SESSION];
    transport.latestQr = {
      serial: "qr-1",
      sessionId: 1,
      phoneNumberId: "12345",
      qrCode: "qr-data",
      status: "expired",
      expiresAt: "2026-01-01T00:00:00Z",
      createdAt: "2026-01-01T00:00:00Z",
    };
    const service = makeService(transport);

    await expect(service.getPairingQr("session-serial-1")).resolves.toEqual({
      status: "expired",
      qrCode: "qr-data",
    });
  });

  it("returns null when the session is missing", async () => {
    const service = makeService();

    await expect(service.getPairingQr("nope")).resolves.toBeNull();
  });
});

describe("SessionService.startLogout", () => {
  it("returns a jobSerial for an existing session", async () => {
    const transport = new FakeSessionTransport();
    transport.sessions = [SAMPLE_SESSION];
    const service = makeService(transport);

    await expect(service.startLogout("session-serial-1")).resolves.toEqual({
      jobSerial: "logout-job-1",
    });
    expect(transport.logoutJobs).toEqual([{ sessionId: 1, phoneNumberId: "12345" }]);
  });

  it("returns null when the session is missing", async () => {
    const service = makeService();

    await expect(service.startLogout("nope")).resolves.toBeNull();
  });
});

describe("SessionService.getStatus", () => {
  it("returns the session status when it exists", async () => {
    const transport = new FakeSessionTransport();
    transport.sessions = [SAMPLE_SESSION];
    const service = makeService(transport);

    await expect(service.getStatus("session-serial-1")).resolves.toEqual({
      status: "connected",
    });
  });

  it("returns null when the session is missing", async () => {
    const service = makeService();

    await expect(service.getStatus("nope")).resolves.toBeNull();
  });
});

describe("SessionService.heartbeat", () => {
  it("calls the transport for a valid phoneNumberId", async () => {
    const transport = new FakeSessionTransport();
    const service = makeService(transport);

    await expect(service.heartbeat("12345")).resolves.toBeUndefined();
    expect(transport.heartbeatCalls).toEqual(["12345"]);
  });

  it("throws ValidationError when phoneNumberId is empty", async () => {
    const transport = new FakeSessionTransport();
    const service = makeService(transport);

    await expect(service.heartbeat("")).rejects.toBeInstanceOf(ValidationError);
    await expect(service.heartbeat("")).rejects.toThrow("phone_number_id is required");
    expect(transport.heartbeatCalls).toEqual([]);
  });
});
