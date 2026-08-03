/**
 * Supabase-backed implementation of the JobTransport driven port.
 *
 * PostgREST surfaces the unique-constraint violation as HTTP 409 with SQLSTATE
 * 23505; supabase-js reports it via `error.code`. A 409 with HTTP status may
 * also surface as code "409" depending on PostgREST version.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { WebhookConfig } from "../../domain/webhook-config.js";
import type { EnqueueInput, JobTransport, PollResult } from "../../ports/job-transport.js";

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

  async getWebhookConfig(phoneNumberId: string): Promise<WebhookConfig | null> {
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

/** Compile-time assertion (Go convention): SupabaseTransport implements JobTransport. */
const _: JobTransport = undefined as unknown as SupabaseTransport;
