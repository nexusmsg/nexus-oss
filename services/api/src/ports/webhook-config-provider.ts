/**
 * Input port: webhook config lookup by phone number. The HTTP adapter depends
 * on this; GetWebhookConfigService implements it.
 */

import type { WebhookConfig } from "../domain/webhook-config.js";

export interface WebhookConfigProvider {
  get(phoneNumberId: string): Promise<WebhookConfig | null>;
}
