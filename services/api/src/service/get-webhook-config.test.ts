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
  it("delegates to the transport and returns the config", async () => {
    const service = new GetWebhookConfigService(
      new FakeJobTransport({ webhook_url: "https://hooks.example.com", webhook_secret: "s3cret" }),
    );

    await expect(service.get("12345")).resolves.toEqual({
      webhook_url: "https://hooks.example.com",
      webhook_secret: "s3cret",
    });
  });

  it("returns null when the transport has no config", async () => {
    const service = new GetWebhookConfigService(new FakeJobTransport(null));

    await expect(service.get("12345")).resolves.toBeNull();
  });
});
