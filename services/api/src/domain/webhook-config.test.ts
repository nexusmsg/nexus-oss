import { describe, expect, it } from "vitest";
import {
  SUPPORTED_EVENT_TYPES,
  type SupportedEventType,
  type WebhookConfig,
  type WebhookSubscription,
} from "./webhook-config.js";

describe("WebhookConfig domain", () => {
  it("SUPPORTED_EVENT_TYPES contains messages, message_status, contacts, sessions", () => {
    expect(SUPPORTED_EVENT_TYPES).toEqual([
      "messages",
      "message_status",
      "contacts",
      "sessions",
    ]);
  });

  it("exposes a SupportedEventType derived type", () => {
    const valid: SupportedEventType = "messages";
    expect(valid).toBe("messages");
  });

  it("WebhookConfig has the documented shape", () => {
    const cfg: WebhookConfig = {
      id: 1,
      serial: "cfg-1",
      phoneNumberId: "12345",
      webhookUrl: "https://hooks.example.com",
      webhookSecret: null,
      enabled: true,
      maxRetries: 3,
      retryDelayMs: 1000,
      timeoutMs: 10000,
      createdAt: "2026-01-01T00:00:00Z",
    };
    expect(cfg.serial).toBe("cfg-1");
    expect(cfg.webhookSecret).toBeNull();
  });

  it("WebhookSubscription has the documented shape", () => {
    const sub: WebhookSubscription = {
      id: 10,
      serial: "sub-1",
      webhookConfigId: 1,
      eventType: "messages",
      createdAt: "2026-01-01T00:00:00Z",
    };
    expect(sub.eventType).toBe("messages");
    expect(sub.webhookConfigId).toBe(1);
  });
});
