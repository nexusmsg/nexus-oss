import { describe, expect, it } from "vitest";
import { ValidationError } from "../domain/errors.js";
import type { WebhookConfig, WebhookSubscription } from "../domain/webhook-config.js";
import type {
  CreateWebhookConfigInput,
  UpdateWebhookConfigInput,
  WebhookConfigManagementTransport,
} from "../ports/webhook-config-management.js";
import { WebhookConfigManagementService } from "./webhook-config-management.js";

const SAMPLE_CONFIG: WebhookConfig = {
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

function sampleSubscription(eventType: string): WebhookSubscription {
  return {
    id: 10,
    serial: `sub-serial-${eventType}`,
    webhookConfigId: 1,
    eventType,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

class FakeTransport implements WebhookConfigManagementTransport {
  configs = new Map<string, WebhookConfig>();
  subscriptions = new Map<number, WebhookSubscription[]>();
  createCalls: CreateWebhookConfigInput[] = [];
  updateCalls: { serial: string; input: UpdateWebhookConfigInput }[] = [];
  deleteCalls: string[] = [];
  private nextSubId = 100;

  constructor(configs: WebhookConfig[] = []) {
    for (const cfg of configs) {
      this.configs.set(cfg.serial, cfg);
      this.subscriptions.set(cfg.id, []);
    }
  }

  async createConfig(input: CreateWebhookConfigInput): Promise<WebhookConfig> {
    this.createCalls.push(input);
    const cfg: WebhookConfig = {
      id: 1,
      serial: "cfg-1",
      phoneNumberId: input.phoneNumberId,
      webhookUrl: input.webhookUrl,
      webhookSecret: input.webhookSecret ?? "no-secret",
      enabled: true,
      maxRetries: 3,
      retryDelayMs: 1000,
      timeoutMs: 10000,
      createdAt: "2026-01-01T00:00:00Z",
    };
    this.configs.set(cfg.serial, cfg);
    this.subscriptions.set(cfg.id, []);
    return cfg;
  }

  async getConfig(serial: string): Promise<WebhookConfig | null> {
    return this.configs.get(serial) ?? null;
  }

  async getConfigByPhoneNumberId(phoneNumberId: string): Promise<WebhookConfig | null> {
    return [...this.configs.values()].find((c) => c.phoneNumberId === phoneNumberId) ?? null;
  }

  async listConfigs(): Promise<WebhookConfig[]> {
    return [...this.configs.values()];
  }

  async updateConfig(serial: string, input: UpdateWebhookConfigInput): Promise<WebhookConfig> {
    this.updateCalls.push({ serial, input });
    const cfg = this.configs.get(serial)!;
    const updated: WebhookConfig = {
      ...cfg,
      webhookUrl: input.webhookUrl ?? cfg.webhookUrl,
      webhookSecret: input.webhookSecret ?? cfg.webhookSecret,
      enabled: input.enabled ?? cfg.enabled,
      maxRetries: input.maxRetries ?? cfg.maxRetries,
      retryDelayMs: input.retryDelayMs ?? cfg.retryDelayMs,
      timeoutMs: input.timeoutMs ?? cfg.timeoutMs,
    };
    this.configs.set(serial, updated);
    return updated;
  }

  async deleteConfig(serial: string): Promise<void> {
    this.deleteCalls.push(serial);
    this.configs.delete(serial);
  }

  async listSubscriptions(configId: number): Promise<WebhookSubscription[]> {
    return this.subscriptions.get(configId) ?? [];
  }

  async addSubscription(configId: number, eventType: string): Promise<WebhookSubscription> {
    const sub = {
      id: this.nextSubId++,
      serial: `sub-serial-${eventType}-${this.nextSubId}`,
      webhookConfigId: configId,
      eventType,
      createdAt: "2026-01-01T00:00:00Z",
    };
    const existing = this.subscriptions.get(configId) ?? [];
    this.subscriptions.set(configId, [...existing, sub]);
    return sub;
  }

  async removeSubscription(configId: number, eventType: string): Promise<void> {
    const existing = this.subscriptions.get(configId) ?? [];
    this.subscriptions.set(configId, existing.filter((s) => s.eventType !== eventType));
  }
}

function makeService(
  transport: WebhookConfigManagementTransport = new FakeTransport(),
): WebhookConfigManagementService {
  return new WebhookConfigManagementService(transport);
}

const VALID_INPUT: CreateWebhookConfigInput = {
  phoneNumberId: "12345",
  webhookUrl: "https://hooks.example.com",
};

describe("WebhookConfigManagementService.createConfig", () => {
  it("creates a config and seeds the messages subscription", async () => {
    const transport = new FakeTransport();
    const service = makeService(transport);

    const result = await service.createConfig(VALID_INPUT);

    expect(result.phoneNumberId).toBe("12345");
    expect(result.webhookUrl).toBe("https://hooks.example.com");
    expect(transport.createCalls).toHaveLength(1);
    expect(transport.createCalls[0]).toMatchObject({ phoneNumberId: "12345", webhookUrl: "https://hooks.example.com" });
    expect(transport.subscriptions.get(1)?.map((s) => s.eventType)).toContain("messages");
  });

  it("generates a secret via randomUUID when absent", async () => {
    const transport = new FakeTransport();
    const service = makeService(transport);

    await service.createConfig({ ...VALID_INPUT, webhookSecret: undefined });

    const createInput = transport.createCalls[0];
    expect(createInput.webhookSecret).toBeDefined();
    expect(typeof createInput.webhookSecret).toBe("string");
    expect(createInput.webhookSecret!.length).toBeGreaterThan(0);
    expect(createInput.webhookSecret).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("throws ValidationError on duplicate phone_number_id", async () => {
    const transport = new FakeTransport([SAMPLE_CONFIG]);
    const service = makeService(transport);

    await expect(service.createConfig(VALID_INPUT)).rejects.toBeInstanceOf(ValidationError);
    await expect(service.createConfig(VALID_INPUT)).rejects.toThrow(
      "phone_number_id already has a webhook config",
    );
  });

  it("throws ValidationError on an invalid URL", async () => {
    const service = makeService();

    await expect(
      service.createConfig({ ...VALID_INPUT, webhookUrl: "not-a-url" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      service.createConfig({ ...VALID_INPUT, webhookUrl: "not-a-url" }),
    ).rejects.toThrow("webhook_url must be a valid http(s) URL");
  });

  it("throws ValidationError when phone_number_id is missing", async () => {
    const service = makeService();

    await expect(service.createConfig({ ...VALID_INPUT, phoneNumberId: " " })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(service.createConfig({ ...VALID_INPUT, phoneNumberId: " " })).rejects.toThrow(
      "phone_number_id is required",
    );
  });
});

describe("WebhookConfigManagementService.getConfig", () => {
  it("returns the config when it exists", async () => {
    const service = makeService(new FakeTransport([SAMPLE_CONFIG]));

    await expect(service.getConfig("cfg-1")).resolves.toEqual(SAMPLE_CONFIG);
  });

  it("returns null when the config is missing", async () => {
    const service = makeService();

    await expect(service.getConfig("nope")).resolves.toBeNull();
  });
});

describe("WebhookConfigManagementService.listConfigs", () => {
  it("returns the array of configs", async () => {
    const service = makeService(new FakeTransport([SAMPLE_CONFIG]));

    await expect(service.listConfigs()).resolves.toEqual([SAMPLE_CONFIG]);
  });
});

describe("WebhookConfigManagementService.updateConfig", () => {
  it("updates an existing config", async () => {
    const transport = new FakeTransport([SAMPLE_CONFIG]);
    const service = makeService(transport);

    const result = await service.updateConfig("cfg-1", { enabled: false, maxRetries: 5 });

    expect(result).toMatchObject({ enabled: false, maxRetries: 5 });
    expect(transport.updateCalls).toEqual([
      { serial: "cfg-1", input: { enabled: false, maxRetries: 5 } },
    ]);
  });

  it("returns null when the config is missing", async () => {
    const service = makeService();

    await expect(service.updateConfig("nope", { enabled: false })).resolves.toBeNull();
  });

  it("throws ValidationError when no fields are provided", async () => {
    const service = makeService(new FakeTransport([SAMPLE_CONFIG]));

    await expect(service.updateConfig("cfg-1", {})).rejects.toBeInstanceOf(ValidationError);
    await expect(service.updateConfig("cfg-1", {})).rejects.toThrow("no fields to update");
  });

  it("throws ValidationError on an invalid URL", async () => {
    const service = makeService(new FakeTransport([SAMPLE_CONFIG]));

    await expect(
      service.updateConfig("cfg-1", { webhookUrl: "ftp://x" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError on a negative maxRetries", async () => {
    const service = makeService(new FakeTransport([SAMPLE_CONFIG]));

    await expect(service.updateConfig("cfg-1", { maxRetries: -1 })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(service.updateConfig("cfg-1", { maxRetries: -1 })).rejects.toThrow(
      "max_retries must be a non-negative integer",
    );
  });
});

describe("WebhookConfigManagementService.deleteConfig", () => {
  it("deletes an existing config and returns it", async () => {
    const transport = new FakeTransport([SAMPLE_CONFIG]);
    const service = makeService(transport);

    const result = await service.deleteConfig("cfg-1");

    expect(result).toEqual(SAMPLE_CONFIG);
    expect(transport.deleteCalls).toEqual(["cfg-1"]);
    await expect(service.getConfig("cfg-1")).resolves.toBeNull();
  });

  it("returns null when the config is missing", async () => {
    const service = makeService();

    await expect(service.deleteConfig("nope")).resolves.toBeNull();
  });
});

describe("WebhookConfigManagementService.listSubscriptions", () => {
  it("returns subscriptions for an existing config", async () => {
    const transport = new FakeTransport([SAMPLE_CONFIG]);
    transport.subscriptions.set(1, [sampleSubscription("messages")]);
    const service = makeService(transport);

    await expect(service.listSubscriptions("cfg-1")).resolves.toEqual([
      sampleSubscription("messages"),
    ]);
  });

  it("returns null when the config is missing", async () => {
    const service = makeService();

    await expect(service.listSubscriptions("nope")).resolves.toBeNull();
  });
});

describe("WebhookConfigManagementService.addSubscription", () => {
  it("adds a subscription for an existing config", async () => {
    const transport = new FakeTransport([SAMPLE_CONFIG]);
    const service = makeService(transport);

    const result = await service.addSubscription("cfg-1", "contacts");

    expect(result).toMatchObject({ eventType: "contacts", webhookConfigId: 1 });
    expect(transport.subscriptions.get(1)?.map((s) => s.eventType)).toContain("contacts");
  });

  it("returns null when the config is missing", async () => {
    const service = makeService();

    await expect(service.addSubscription("nope", "contacts")).resolves.toBeNull();
  });

  it("throws ValidationError on an invalid event_type", async () => {
    const service = makeService(new FakeTransport([SAMPLE_CONFIG]));

    await expect(service.addSubscription("cfg-1", "bogus")).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(service.addSubscription("cfg-1", "bogus")).rejects.toThrow(
      "event_type must be one of",
    );
  });
});

describe("WebhookConfigManagementService.removeSubscription", () => {
  it("removes a subscription for an existing config", async () => {
    const transport = new FakeTransport([SAMPLE_CONFIG]);
    transport.subscriptions.set(1, [sampleSubscription("messages")]);
    const service = makeService(transport);

    const result = await service.removeSubscription("cfg-1", "messages");

    expect(result).toEqual(SAMPLE_CONFIG);
    expect(transport.subscriptions.get(1)?.map((s) => s.eventType)).not.toContain("messages");
  });

  it("returns null when the config is missing", async () => {
    const service = makeService();

    await expect(service.removeSubscription("nope", "messages")).resolves.toBeNull();
  });
});
