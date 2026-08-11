/**
 * Unit + functional tests for `WebhookConfigManagementService` against an
 * in-memory fake implementing the driven `WebhookConfigManagementTransport`
 * port. Covers create-generated secret, plaintext secret read-back, input
 * validation, duplicate rejection, the seeded default `messages`
 * subscription, partial update, and delete.
 */

import { describe, expect, it } from "vitest";
import { ValidationError } from "../domain/errors";
import type {
  WebhookConfig,
  WebhookSubscription,
} from "../domain/webhook-config";
import type {
  CreateWebhookConfigInput,
  UpdateWebhookConfigInput,
  WebhookConfigManagementTransport,
} from "../ports/webhook-config-management";
import { WebhookConfigManagementService } from "./webhook-config-management";

/** In-memory implementation of the driven port; mirrors the real adapter's semantics. */
class FakeTransport implements WebhookConfigManagementTransport {
  configsBySerial = new Map<string, WebhookConfig>();
  subscriptionsByConfigId = new Map<number, WebhookSubscription[]>();
  nextConfigId = 1;
  nextSubscriptionId = 1;
  createCalls: CreateWebhookConfigInput[] = [];

  async createConfig(input: CreateWebhookConfigInput): Promise<WebhookConfig> {
    this.createCalls.push(input);
    const config: WebhookConfig = {
      id: this.nextConfigId++,
      serial: `cfg_${this.nextConfigId}`,
      phoneNumberId: input.phoneNumberId,
      webhookUrl: input.webhookUrl,
      webhookSecret: input.webhookSecret ?? null,
      enabled: true,
      maxRetries: 3,
      retryDelayMs: 1000,
      timeoutMs: 10000,
      createdAt: "2026-08-10T00:00:00.000Z",
    };
    this.configsBySerial.set(config.serial, config);
    this.subscriptionsByConfigId.set(config.id, []);
    return config;
  }

  async getConfig(serial: string): Promise<WebhookConfig | null> {
    return this.configsBySerial.get(serial) ?? null;
  }

  async getConfigByPhoneNumberId(phoneNumberId: string): Promise<WebhookConfig | null> {
    for (const config of this.configsBySerial.values()) {
      if (config.phoneNumberId === phoneNumberId) return config;
    }
    return null;
  }

  async listConfigs(): Promise<WebhookConfig[]> {
    return [...this.configsBySerial.values()];
  }

  async updateConfig(
    serial: string,
    input: UpdateWebhookConfigInput,
  ): Promise<WebhookConfig> {
    const config = this.configsBySerial.get(serial);
    if (config === undefined) {
      throw new Error(`no config for serial ${serial}`);
    }
    const updated: WebhookConfig = {
      ...config,
      webhookUrl: input.webhookUrl ?? config.webhookUrl,
      webhookSecret: input.webhookSecret ?? config.webhookSecret,
      enabled: input.enabled ?? config.enabled,
      maxRetries: input.maxRetries ?? config.maxRetries,
      retryDelayMs: input.retryDelayMs ?? config.retryDelayMs,
      timeoutMs: input.timeoutMs ?? config.timeoutMs,
    };
    this.configsBySerial.set(serial, updated);
    return updated;
  }

  async deleteConfig(serial: string): Promise<void> {
    this.configsBySerial.delete(serial);
  }

  async listSubscriptions(configId: number): Promise<WebhookSubscription[]> {
    return this.subscriptionsByConfigId.get(configId) ?? [];
  }

  async addSubscription(configId: number, eventType: string): Promise<WebhookSubscription> {
    const subscription: WebhookSubscription = {
      id: this.nextSubscriptionId++,
      serial: `sub_${this.nextSubscriptionId}`,
      webhookConfigId: configId,
      eventType,
      createdAt: "2026-08-10T00:00:00.000Z",
    };
    this.subscriptionsByConfigId.set(configId, [
      ...(this.subscriptionsByConfigId.get(configId) ?? []),
      subscription,
    ]);
    return subscription;
  }

  async removeSubscription(configId: number, eventType: string): Promise<void> {
    this.subscriptionsByConfigId.set(
      configId,
      (this.subscriptionsByConfigId.get(configId) ?? []).filter(
        (s) => s.eventType !== eventType,
      ),
    );
  }
}

/** UUID v4 shape produced by `randomUUID` in the service's create flow. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("WebhookConfigManagementService", () => {
  it("generates a secret on create when none is provided", async () => {
    const transport = new FakeTransport();
    const service = new WebhookConfigManagementService(transport);

    const config = await service.createConfig({
      phoneNumberId: "123",
      webhookUrl: "https://hooks.example.com/wa",
    });

    expect(transport.createCalls).toHaveLength(1);
    expect(transport.createCalls[0].webhookSecret).toMatch(UUID_V4);
    expect(config.webhookSecret).toMatch(UUID_V4);
    expect(config.webhookSecret).toBe(transport.createCalls[0].webhookSecret);
  });

  it("preserves a caller-provided webhook secret on create", async () => {
    const transport = new FakeTransport();
    const service = new WebhookConfigManagementService(transport);

    const config = await service.createConfig({
      phoneNumberId: "123",
      webhookUrl: "https://hooks.example.com/wa",
      webhookSecret: "my-plain-secret",
    });

    expect(transport.createCalls[0].webhookSecret).toBe("my-plain-secret");
    expect(config.webhookSecret).toBe("my-plain-secret");
  });

  it("returns the plaintext secret on read-back", async () => {
    const transport = new FakeTransport();
    const service = new WebhookConfigManagementService(transport);

    const created = await service.createConfig({
      phoneNumberId: "123",
      webhookUrl: "https://hooks.example.com/wa",
      webhookSecret: "plain-secret",
    });

    const read = await service.getConfig(created.serial);
    expect(read?.webhookSecret).toBe("plain-secret");
  });

  it("seeds the default messages subscription on create", async () => {
    const transport = new FakeTransport();
    const service = new WebhookConfigManagementService(transport);

    const config = await service.createConfig({
      phoneNumberId: "123",
      webhookUrl: "https://hooks.example.com/wa",
    });

    const subscriptions = await transport.listSubscriptions(config.id);
    expect(subscriptions.map((s) => s.eventType)).toEqual(["messages"]);
  });

  it("rejects a missing phone_number_id", async () => {
    const service = new WebhookConfigManagementService(new FakeTransport());

    await expect(
      service.createConfig({
        phoneNumberId: " ",
        webhookUrl: "https://hooks.example.com/wa",
      }),
    ).rejects.toThrow(ValidationError);
    await expect(
      service.createConfig({
        phoneNumberId: "",
        webhookUrl: "https://hooks.example.com/wa",
      }),
    ).rejects.toThrow("phone_number_id is required");
  });

  it("rejects an invalid webhook_url", async () => {
    const service = new WebhookConfigManagementService(new FakeTransport());

    await expect(
      service.createConfig({ phoneNumberId: "123", webhookUrl: "not-a-url" }),
    ).rejects.toThrow(ValidationError);
    await expect(
      service.createConfig({ phoneNumberId: "123", webhookUrl: "ftp://x" }),
    ).rejects.toThrow("webhook_url must be a valid http(s) URL");
  });

  it("rejects creating a config for an existing phone_number_id", async () => {
    const transport = new FakeTransport();
    const service = new WebhookConfigManagementService(transport);
    await service.createConfig({
      phoneNumberId: "123",
      webhookUrl: "https://hooks.example.com/wa",
    });

    await expect(
      service.createConfig({
        phoneNumberId: "123",
        webhookUrl: "https://hooks.example.com/other",
      }),
    ).rejects.toThrow("phone_number_id already has a webhook config");
  });

  it("does not seed subscriptions for a rejected create", async () => {
    const transport = new FakeTransport();
    const service = new WebhookConfigManagementService(transport);

    await expect(
      service.createConfig({ phoneNumberId: "", webhookUrl: "not-a-url" }),
    ).rejects.toThrow(ValidationError);
    expect(transport.createCalls).toHaveLength(0);
    expect(transport.subscriptionsByConfigId.size).toBe(0);
  });

  it("lists configs via the transport", async () => {
    const transport = new FakeTransport();
    const service = new WebhookConfigManagementService(transport);
    await service.createConfig({
      phoneNumberId: "123",
      webhookUrl: "https://hooks.example.com/wa",
    });

    const configs = await service.listConfigs();
    expect(configs).toHaveLength(1);
    expect(configs[0].phoneNumberId).toBe("123");
  });

  describe("updateConfig", () => {
    it("applies a partial update and returns the updated config", async () => {
      const transport = new FakeTransport();
      const service = new WebhookConfigManagementService(transport);
      const created = await service.createConfig({
        phoneNumberId: "123",
        webhookUrl: "https://hooks.example.com/wa",
      });

      const updated = await service.updateConfig(created.serial, {
        enabled: false,
        maxRetries: 5,
        retryDelayMs: 2000,
        timeoutMs: 15000,
      });

      expect(updated?.enabled).toBe(false);
      expect(updated?.maxRetries).toBe(5);
      expect(updated?.retryDelayMs).toBe(2000);
      expect(updated?.timeoutMs).toBe(15000);
      // Untouched fields keep their values.
      expect(updated?.webhookUrl).toBe("https://hooks.example.com/wa");
      expect(updated?.webhookSecret).not.toBeNull();

      const read = await service.getConfig(created.serial);
      expect(read?.enabled).toBe(false);
    });

    it("updates the webhook_secret in plaintext", async () => {
      const transport = new FakeTransport();
      const service = new WebhookConfigManagementService(transport);
      const created = await service.createConfig({
        phoneNumberId: "123",
        webhookUrl: "https://hooks.example.com/wa",
      });

      const updated = await service.updateConfig(created.serial, {
        webhookSecret: "rotated-secret",
      });

      expect(updated?.webhookSecret).toBe("rotated-secret");
    });

    it("returns null for an unknown serial", async () => {
      const service = new WebhookConfigManagementService(new FakeTransport());

      await expect(
        service.updateConfig("nope", { enabled: false }),
      ).resolves.toBeNull();
    });

    it("rejects an empty update", async () => {
      const transport = new FakeTransport();
      const service = new WebhookConfigManagementService(transport);
      const created = await service.createConfig({
        phoneNumberId: "123",
        webhookUrl: "https://hooks.example.com/wa",
      });

      await expect(service.updateConfig(created.serial, {})).rejects.toThrow(
        ValidationError,
      );
      await expect(service.updateConfig(created.serial, {})).rejects.toThrow(
        "no fields to update",
      );
    });

    it("rejects an invalid webhook_url on update", async () => {
      const transport = new FakeTransport();
      const service = new WebhookConfigManagementService(transport);
      const created = await service.createConfig({
        phoneNumberId: "123",
        webhookUrl: "https://hooks.example.com/wa",
      });

      await expect(
        service.updateConfig(created.serial, { webhookUrl: "ftp://x" }),
      ).rejects.toThrow("webhook_url must be a valid http(s) URL");
    });

    it("rejects invalid retry policy values on update", async () => {
      const transport = new FakeTransport();
      const service = new WebhookConfigManagementService(transport);
      const created = await service.createConfig({
        phoneNumberId: "123",
        webhookUrl: "https://hooks.example.com/wa",
      });

      await expect(
        service.updateConfig(created.serial, { maxRetries: -1 }),
      ).rejects.toThrow("max_retries must be a non-negative integer");
      await expect(
        service.updateConfig(created.serial, { retryDelayMs: 1.5 }),
      ).rejects.toThrow("retry_delay_ms must be a non-negative integer");
      await expect(
        service.updateConfig(created.serial, { timeoutMs: -100 }),
      ).rejects.toThrow("timeout_ms must be a non-negative integer");
    });
  });

  describe("deleteConfig", () => {
    it("deletes an existing config and returns it", async () => {
      const transport = new FakeTransport();
      const service = new WebhookConfigManagementService(transport);
      const created = await service.createConfig({
        phoneNumberId: "123",
        webhookUrl: "https://hooks.example.com/wa",
      });

      const deleted = await service.deleteConfig(created.serial);
      expect(deleted).toEqual(created);
      await expect(service.getConfig(created.serial)).resolves.toBeNull();
    });

    it("returns null for an unknown serial", async () => {
      const service = new WebhookConfigManagementService(new FakeTransport());

      await expect(service.deleteConfig("nope")).resolves.toBeNull();
    });
  });
});
