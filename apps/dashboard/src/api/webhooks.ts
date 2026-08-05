import { apiFetch } from "./client";

// ── Webhook types ──

export interface WebhookConfig {
  id: string;
  serial: string;
  phone_number_id: string;
  webhook_url: string;
  webhook_secret: string | null;
  enabled: boolean;
  max_retries: number;
  retry_delay_ms: number;
  timeout_ms: number;
  created_at: string;
}

export interface Subscription {
  eventType: string;
}

// ── Webhook API functions ──

export function listWebhooks(): Promise<{ webhooks: WebhookConfig[] }> {
  return apiFetch("/api/v1/webhooks");
}

export function getWebhook(serial: string): Promise<WebhookConfig> {
  return apiFetch(`/api/v1/webhooks/${serial}`);
}

export function createWebhook(data: {
  phone_number_id: string;
  webhook_url: string;
  webhook_secret?: string;
}): Promise<WebhookConfig> {
  return apiFetch("/api/v1/webhooks", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateWebhook(
  serial: string,
  data: {
    webhook_url?: string;
    webhook_secret?: string;
    enabled?: boolean;
    max_retries?: number;
    retry_delay_ms?: number;
    timeout_ms?: number;
  },
): Promise<WebhookConfig> {
  return apiFetch(`/api/v1/webhooks/${serial}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteWebhook(serial: string): Promise<void> {
  return apiFetch(`/api/v1/webhooks/${serial}`, {
    method: "DELETE",
  });
}

export function getSubscriptions(
  serial: string,
): Promise<{ subscriptions: Subscription[] }> {
  return apiFetch(`/api/v1/webhooks/${serial}/subscriptions`);
}
