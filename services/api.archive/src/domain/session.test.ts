import { describe, expect, it } from "vitest";
import type { CreateSessionInput, QrCodeStatus, Session, SessionQrCode, SessionStatus } from "./session.js";

describe("Session domain types", () => {
  it("exposes the SessionStatus union", () => {
    const statuses: SessionStatus[] = [
      "created",
      "pairing",
      "connected",
      "disconnected",
      "logged_out",
    ];
    expect(statuses).toHaveLength(5);
    expect(statuses).toContain("connected");
  });

  it("exposes the QrCodeStatus union", () => {
    const statuses: QrCodeStatus[] = ["pending", "ready", "expired"];
    expect(statuses).toHaveLength(3);
    expect(statuses).toContain("expired");
  });

  it("CreateSessionInput accepts required fields with an optional displayPhone", () => {
    // Compile-time shape usage: assigning a literal to the type proves the
    // required/optional field contract at build time.
    const input: CreateSessionInput = {
      phoneNumberId: "12345",
      number: "62812345678",
      displayPhone: "62812345678",
    };
    expect(input.phoneNumberId).toBe("12345");
    expect(input.number).toBe("62812345678");

    const minimal: CreateSessionInput = {
      phoneNumberId: "12345",
      number: "62812345678",
    };
    expect(minimal.displayPhone).toBeUndefined();
  });

  it("Session includes the documented fields", () => {
    const session: Session = {
      id: 1,
      serial: "serial-1",
      phoneNumberId: "12345",
      number: "62812345678",
      displayPhone: "62812345678",
      businessAccountId: "",
      status: "connected",
      whatsappId: null,
      connectedAt: null,
      lastSeenAt: null,
      loggedOutAt: null,
      createdAt: "2026-01-01T00:00:00Z",
    };
    expect(session.id).toBe(1);
    expect(session.status).toBe("connected");
  });

  it("SessionQrCode includes the documented fields", () => {
    const qr: SessionQrCode = {
      serial: "qr-1",
      sessionId: 1,
      phoneNumberId: "12345",
      qrCode: "qr-data",
      status: "ready",
      expiresAt: "2026-01-01T00:00:00Z",
      createdAt: "2026-01-01T00:00:00Z",
    };
    expect(qr.sessionId).toBe(1);
    expect(qr.status).toBe("ready");
  });
});
