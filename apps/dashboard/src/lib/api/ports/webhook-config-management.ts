/**
 * Driven port: persistence access for webhook config management. The Supabase
 * adapter implements it; the WebhookConfigManagementService depends on it.
 *
 * Config CRUD is keyed by `serial`; subscriptions are keyed by the numeric
 * config id (resolved from the serial by the service layer).
 */

import type {
  WebhookConfig,
  WebhookSubscription,
} from "../domain/webhook-config";

export interface CreateWebhookConfigInput {
  phoneNumberId: string;
  webhookUrl: string;
  webhookSecret?: string;
}

export interface UpdateWebhookConfigInput {
  webhookUrl?: string;
  webhookSecret?: string;
  enabled?: boolean;
  maxRetries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
}

export interface WebhookConfigManagementTransport {
  // CRUD
  createConfig(input: CreateWebhookConfigInput): Promise<WebhookConfig>;
  getConfig(serial: string): Promise<WebhookConfig | null>;
  getConfigByPhoneNumberId(phoneNumberId: string): Promise<WebhookConfig | null>;
  listConfigs(): Promise<WebhookConfig[]>;
  updateConfig(serial: string, input: UpdateWebhookConfigInput): Promise<WebhookConfig>;
  deleteConfig(serial: string): Promise<void>;
  // Subscriptions
  listSubscriptions(configId: number): Promise<WebhookSubscription[]>;
  addSubscription(configId: number, eventType: string): Promise<WebhookSubscription>;
  removeSubscription(configId: number, eventType: string): Promise<void>;
}
