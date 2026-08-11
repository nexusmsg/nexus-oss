/* ── Webhooks API ──
 *
 * Typed functions for the `/api/v1/webhooks*` routes served by
 * `services/api/src/adapters/http/app.ts`. All errors surface as `ApiError`
 * with the WABA envelope normalized by the client. `webhook_secret` is
 * returned in plaintext by the backend and preserved as-is.
 */

import { apiDelete, apiGet, apiPatch, apiPost } from "./client";
import type {
  CreateWebhookInput,
  SubscriptionsListResponse,
  UpdateWebhookInput,
  WebhookConfig,
  WebhookSubscription,
  WebhooksListResponse,
} from "./types";

export async function listWebhooks(): Promise<WebhookConfig[]> {
  const res = await apiGet<WebhooksListResponse>("/api/v1/webhooks");
  return res.webhooks;
}

export async function createWebhook(input: CreateWebhookInput): Promise<WebhookConfig> {
  return apiPost<WebhookConfig>("/api/v1/webhooks", input);
}

export async function getWebhook(serial: string): Promise<WebhookConfig> {
  return apiGet<WebhookConfig>(`/api/v1/webhooks/${encodeURIComponent(serial)}`);
}

export async function updateWebhook(
  serial: string,
  input: UpdateWebhookInput,
): Promise<WebhookConfig> {
  return apiPatch<WebhookConfig>(`/api/v1/webhooks/${encodeURIComponent(serial)}`, input);
}

export async function deleteWebhook(serial: string): Promise<void> {
  await apiDelete(`/api/v1/webhooks/${encodeURIComponent(serial)}`);
}

export async function listSubscriptions(serial: string): Promise<WebhookSubscription[]> {
  const res = await apiGet<SubscriptionsListResponse>(
    `/api/v1/webhooks/${encodeURIComponent(serial)}/subscriptions`,
  );
  return res.subscriptions;
}

export async function addSubscription(
  serial: string,
  eventType: string,
): Promise<WebhookSubscription> {
  return apiPost<WebhookSubscription>(
    `/api/v1/webhooks/${encodeURIComponent(serial)}/subscriptions`,
    { event_type: eventType },
  );
}

export async function removeSubscription(serial: string, eventType: string): Promise<void> {
  await apiDelete(
    `/api/v1/webhooks/${encodeURIComponent(serial)}/subscriptions/${encodeURIComponent(eventType)}`,
  );
}
