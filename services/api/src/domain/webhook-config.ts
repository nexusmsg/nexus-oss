/**
 * Webhook forwarding config for a phone number. Pure domain type.
 */
export interface WebhookConfig {
  webhook_url: string;
  webhook_secret: string | null;
}
