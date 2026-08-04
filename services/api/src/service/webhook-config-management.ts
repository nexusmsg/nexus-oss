/**
 * Application service implementing webhook config management. Validates input,
 * resolves serial → numeric config id for subscriptions, seeds the default
 * `messages` subscription on create, and delegates persistence to the driven
 * WebhookConfigManagementTransport port. Imports only domain + ports.
 */

import { randomUUID } from "node:crypto";
import type {
  WebhookConfig,
  WebhookSubscription,
} from "../domain/webhook-config.js";
import { SUPPORTED_EVENT_TYPES } from "../domain/webhook-config.js";
import { ValidationError } from "../domain/errors.js";
import type {
  CreateWebhookConfigInput,
  UpdateWebhookConfigInput,
  WebhookConfigManagementTransport,
} from "../ports/webhook-config-management.js";

/** Application-facing port for webhook config management (HTTP adapter depends on this). */
export interface WebhookConfigManagementServicePort {
  createConfig(input: CreateWebhookConfigInput): Promise<WebhookConfig>;
  getConfig(serial: string): Promise<WebhookConfig | null>;
  listConfigs(): Promise<WebhookConfig[]>;
  updateConfig(
    serial: string,
    input: UpdateWebhookConfigInput,
  ): Promise<WebhookConfig | null>;
  deleteConfig(serial: string): Promise<WebhookConfig | null>;
  listSubscriptions(serial: string): Promise<WebhookSubscription[] | null>;
  addSubscription(
    serial: string,
    eventType: string,
  ): Promise<WebhookSubscription | null>;
  removeSubscription(serial: string, eventType: string): Promise<WebhookConfig | null>;
}

export class WebhookConfigManagementService
  implements WebhookConfigManagementServicePort
{
  private readonly transport: WebhookConfigManagementTransport;

  constructor(transport: WebhookConfigManagementTransport) {
    this.transport = transport;
  }

  async createConfig(input: CreateWebhookConfigInput): Promise<WebhookConfig> {
    const validated = validateCreateInput(input);

    const existing = await this.transport.getConfigByPhoneNumberId(
      validated.phoneNumberId,
    );
    if (existing !== null) {
      throw new ValidationError("phone_number_id already has a webhook config");
    }

    const config = await this.transport.createConfig({
      ...validated,
      webhookSecret: validated.webhookSecret ?? randomUUID(),
    });

    // Seed the default inbound-messages subscription.
    await this.transport.addSubscription(config.id, "messages");

    return config;
  }

  async getConfig(serial: string): Promise<WebhookConfig | null> {
    return this.transport.getConfig(serial);
  }

  async listConfigs(): Promise<WebhookConfig[]> {
    return this.transport.listConfigs();
  }

  async updateConfig(
    serial: string,
    input: UpdateWebhookConfigInput,
  ): Promise<WebhookConfig | null> {
    const config = await this.transport.getConfig(serial);
    if (config === null) {
      return null;
    }
    const validated = validateUpdateInput(input);
    return this.transport.updateConfig(serial, validated);
  }

  async deleteConfig(serial: string): Promise<WebhookConfig | null> {
    const config = await this.transport.getConfig(serial);
    if (config === null) {
      return null;
    }
    await this.transport.deleteConfig(serial);
    return config;
  }

  async listSubscriptions(serial: string): Promise<WebhookSubscription[] | null> {
    const config = await this.transport.getConfig(serial);
    if (config === null) {
      return null;
    }
    return this.transport.listSubscriptions(config.id);
  }

  async addSubscription(
    serial: string,
    eventType: string,
  ): Promise<WebhookSubscription | null> {
    const config = await this.transport.getConfig(serial);
    if (config === null) {
      return null;
    }
    return this.transport.addSubscription(config.id, validateEventType(eventType));
  }

  async removeSubscription(
    serial: string,
    eventType: string,
  ): Promise<WebhookConfig | null> {
    const config = await this.transport.getConfig(serial);
    if (config === null) {
      return null;
    }
    await this.transport.removeSubscription(config.id, eventType);
    return config;
  }
}

function validateCreateInput(input: CreateWebhookConfigInput): CreateWebhookConfigInput {
  if (!isNonEmptyString(input.phoneNumberId)) {
    throw new ValidationError("phone_number_id is required");
  }
  if (!isValidWebhookUrl(input.webhookUrl)) {
    throw new ValidationError("webhook_url must be a valid http(s) URL");
  }
  return input;
}

function validateUpdateInput(input: UpdateWebhookConfigInput): UpdateWebhookConfigInput {
  const hasAnyField =
    input.webhookUrl !== undefined ||
    input.webhookSecret !== undefined ||
    input.enabled !== undefined ||
    input.maxRetries !== undefined ||
    input.retryDelayMs !== undefined ||
    input.timeoutMs !== undefined;
  if (!hasAnyField) {
    throw new ValidationError("no fields to update");
  }
  if (input.webhookUrl !== undefined && !isValidWebhookUrl(input.webhookUrl)) {
    throw new ValidationError("webhook_url must be a valid http(s) URL");
  }
  if (input.maxRetries !== undefined && (!Number.isInteger(input.maxRetries) || input.maxRetries < 0)) {
    throw new ValidationError("max_retries must be a non-negative integer");
  }
  if (input.retryDelayMs !== undefined && (!Number.isInteger(input.retryDelayMs) || input.retryDelayMs < 0)) {
    throw new ValidationError("retry_delay_ms must be a non-negative integer");
  }
  if (input.timeoutMs !== undefined && (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 0)) {
    throw new ValidationError("timeout_ms must be a non-negative integer");
  }
  return input;
}

function validateEventType(eventType: string): string {
  if (
    !SUPPORTED_EVENT_TYPES.includes(eventType as (typeof SUPPORTED_EVENT_TYPES)[number])
  ) {
    throw new ValidationError(
      `event_type must be one of: ${SUPPORTED_EVENT_TYPES.join(", ")}`,
    );
  }
  return eventType;
}

function isValidWebhookUrl(value: string): boolean {
  if (!isNonEmptyString(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** Compile-time assertion (Go convention): service implements the app port. */
const _: WebhookConfigManagementServicePort =
  undefined as unknown as WebhookConfigManagementService;
