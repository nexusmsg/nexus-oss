/**
 * Job transport abstraction (jobs + webhook configs) plus the Supabase-backed
 * implementation. The app layer depends on the `JobTransport` interface so
 * tests can inject a fake transport that performs no network I/O.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface EnqueueInput {
  phoneNumberId: string;
  payload: unknown;
  idempotencyKey?: string;
}

export interface PollResult {
  status: string;
  result: unknown;
  lastError: string | null;
}

export interface WebhookConfigRow {
  webhook_url: string;
  webhook_secret: string | null;
}

export interface JobTransport {
  /** INSERT a send_message job and return its `serial`. */
  enqueue(input: EnqueueInput): Promise<string>;
  /** Fetch a job by serial (ignores soft-deleted rows); null when absent. */
  poll(serial: string): Promise<PollResult | null>;
  /** Fetch webhook config by phone_number_id; null when absent. */
  getWebhookConfig(phoneNumberId: string): Promise<WebhookConfigRow | null>;
}

/**
 * PostgREST surfaces the unique-constraint violation as HTTP 409 with SQLSTATE
 * 23505; supabase-js reports it via `error.code`. A 409 with HTTP status may
 * also surface as code "409" depending on PostgREST version.
 */
const UNIQUE_VIOLATION_CODES = new Set(["23505", "409"]);

export class SupabaseTransport implements JobTransport {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  async enqueue({ phoneNumberId, payload, idempotencyKey }: EnqueueInput): Promise<string> {
    const row: Record<string, unknown> = {
      type: "send_message",
      phone_number_id: phoneNumberId,
      payload,
    };
    if (idempotencyKey !== undefined && idempotencyKey !== "") {
      row.idempotency_key = idempotencyKey;
    }

    const { data, error } = await this.client
      .from("jobs")
      .insert(row)
      .select("serial,status")
      .single();

    if (error) {
      // Idempotency key already used: return the existing job's serial instead
      // of erroring, so the caller can poll for that job's result.
      if (
        UNIQUE_VIOLATION_CODES.has(String(error.code ?? "")) &&
        idempotencyKey !== undefined &&
        idempotencyKey !== ""
      ) {
        const existing = await this.fetchJobBy("idempotency_key", idempotencyKey);
        if (existing !== null) {
          return existing.serial;
        }
      }
      throw new Error(`enqueue job: ${error.message}`);
    }
    if (data === null) {
      throw new Error("enqueue job: no row returned");
    }
    return data.serial;
  }

  async poll(serial: string): Promise<PollResult | null> {
    const { data, error } = await this.client
      .from("jobs")
      .select("status,result,last_error")
      .eq("serial", serial)
      .eq("deleted_at", null)
      .maybeSingle();

    if (error) {
      throw new Error(`poll job: ${error.message}`);
    }
    if (data === null) {
      return null;
    }
    return {
      status: data.status,
      result: data.result,
      lastError: data.last_error,
    };
  }

  async getWebhookConfig(phoneNumberId: string): Promise<WebhookConfigRow | null> {
    const { data, error } = await this.client
      .from("webhook_configs")
      .select("webhook_url,webhook_secret")
      .eq("phone_number_id", phoneNumberId)
      .eq("deleted_at", null)
      .maybeSingle();

    if (error) {
      throw new Error(`get webhook config: ${error.message}`);
    }
    if (data === null) {
      return null;
    }
    return {
      webhook_url: data.webhook_url,
      webhook_secret: data.webhook_secret,
    };
  }

  private async fetchJobBy(
    column: string,
    value: string,
  ): Promise<{ serial: string; status: string } | null> {
    const { data, error } = await this.client
      .from("jobs")
      .select("serial,status")
      .eq(column, value)
      .eq("deleted_at", null)
      .maybeSingle();

    if (error) {
      throw new Error(`fetch job by ${column}: ${error.message}`);
    }
    return data ?? null;
  }
}

export { createClient };
