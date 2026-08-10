import { describe, expect, it } from "vitest";
import type { WebhookConfig } from "../domain/webhook-config.js";
import type { EnqueueInput, JobTransport, PollResult } from "../ports/job-transport.js";
import { GetWebhookConfigService } from "./get-webhook-config.js";

class FakeJobTransport implements JobTransport {
  constructor(private readonly webhookConfig: WebhookConfig | null = null) {}

  async enqueue(_input: EnqueueInput): Promise<string> {
    return "serial-1";
  }

  async poll(_serial: string): Promise<PollResult | null> {
    return null;
  }

  async getWebhookConfig(_phoneNumberId: string): Promise<WebhookConfig | null> {
    return this.webhookConfig;
  }
}

describe("GetWebhookConfigService.get", () => {
  const CONFIG: WebhookConfig = {
    id: 1,
    serial: "cfg-1",
    phoneNumberId: "12345",
    webhookUrl: "https://hooks.example.com",
    webhookSecret: "s3cret",
    enabled: true,
    maxRetries: 3,
    retryDelayMs: 1000,
    timeoutMs: 10000,
    createdAt: "2026-01-01T00:00:00Z",
  };

  it("delegates to the transport and returns the config", async () => {
    const service = new GetWebhookConfigService(new FakeJobTransport(CONFIG));

    await expect(service.get("12345")).resolves.toEqual(CONFIG);
  });

  it("returns null when the transport has no config", async () => {
    const service = new GetWebhookConfigService(new FakeJobTransport(null));

    await expect(service.get("12345")).resolves.toBeNull();
  });
});
