/**
 * Webhook forwarding config for a phone number. Pure domain type.
 */

export interface WebhookConfig {
  id: number;
  serial: string;
  phoneNumberId: string;
  webhookUrl: string;
  webhookSecret: string | null;
  enabled: boolean;
  maxRetries: number;
  retryDelayMs: number;
  timeoutMs: number;
  createdAt: string;
}

export interface WebhookSubscription {
  id: number;
  serial: string;
  webhookConfigId: number;
  eventType: string;
  createdAt: string;
}

/**
 * Event types a webhook config can subscribe to. A config is seeded with the
 * `messages` subscription by default on creation.
 */
export const SUPPORTED_EVENT_TYPES = [
  "messages", // inbound messages
  "message_status", // delivery/read receipts
  "contacts", // contact changes
  "sessions", // session lifecycle events
] as const;

export type SupportedEventType = (typeof SUPPORTED_EVENT_TYPES)[number];
