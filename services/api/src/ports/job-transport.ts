/**
 * Driven port: persistence access for jobs and webhook configs. The Supabase
 * adapter implements it; the application layer (services) depends on it.
 */

import type { WebhookConfig } from "../domain/webhook-config.js";

export interface EnqueueInput {
  phoneNumberId: string;
  payload: unknown;
  idempotencyKey?: string;
}

/** Raw job status row as returned by `poll`. */
export interface PollResult {
  status: string;
  result: unknown;
  lastError: string | null;
}

export interface JobTransport {
  /** INSERT a send_message job and return its `serial`. */
  enqueue(input: EnqueueInput): Promise<string>;
  /** Fetch a job by serial (ignores soft-deleted rows); null when absent. */
  poll(serial: string): Promise<PollResult | null>;
  /** Fetch webhook config by phone_number_id; null when absent. */
  getWebhookConfig(phoneNumberId: string): Promise<WebhookConfig | null>;
}
