/**
 * Supabase-backed implementation of the JobTransport driven port.
 *
 * Uses @supabase/postgrest-js's `PostgrestClient` (not supabase-js) because
 * it talks to PostgREST directly: the URL is used as-is, whereas supabase-js
 * appends `/rest/v1` (matching Supabase's Kong routing) and fails against a
 * bare PostgREST instance.
 *
 * PostgREST surfaces the unique-constraint violation as HTTP 409 with SQLSTATE
 * 23505; postgrest-js reports it via `error.code`. A 409 with HTTP status may
 * also surface as code "409" depending on PostgREST version.
 */

import { randomUUID } from "node:crypto";
import { PostgrestClient } from "@supabase/postgrest-js";
import type {
  CreateSessionInput,
  Session,
  SessionQrCode,
} from "../../domain/session.js";
import type {
  WebhookConfig,
  WebhookSubscription,
} from "../../domain/webhook-config.js";
import type { EnqueueInput, JobTransport, PollResult } from "../../ports/job-transport.js";
import type { SessionTransport } from "../../ports/session-transport.js";
import type {
  CreateWebhookConfigInput,
  UpdateWebhookConfigInput,
  WebhookConfigManagementTransport,
} from "../../ports/webhook-config-management.js";

const UNIQUE_VIOLATION_CODES = new Set(["23505", "409"]);

export class SupabaseTransport
  implements JobTransport, SessionTransport, WebhookConfigManagementTransport
{
  private readonly client: PostgrestClient;

  constructor(client: PostgrestClient) {
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
      .is("deleted_at", null)
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
      .select("*")
      .eq("phone_number_id", phoneNumberId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      throw new Error(`get webhook config: ${error.message}`);
    }
    return data === null ? null : this.mapWebhookConfig(data);
  }

  // ---------------------------------------------------------------------------
  // WebhookConfigManagementTransport
  // ---------------------------------------------------------------------------

  async createConfig(input: CreateWebhookConfigInput): Promise<WebhookConfig> {
    const row: Record<string, unknown> = {
      phone_number_id: input.phoneNumberId,
      webhook_url: input.webhookUrl,
      webhook_secret: input.webhookSecret ?? randomUUID(),
    };

    const { data, error } = await this.client
      .from("webhook_configs")
      .insert(row)
      .select("*")
      .single();

    if (error) {
      // phone_number_id is unique: a repeat create returns the existing config
      // instead of erroring, so the caller stays idempotent.
      if (UNIQUE_VIOLATION_CODES.has(String(error.code ?? ""))) {
        const existing = await this.fetchConfigBy("phone_number_id", input.phoneNumberId);
        if (existing !== null) {
          return existing;
        }
      }
      throw new Error(`create webhook config: ${error.message}`);
    }
    if (data === null) {
      throw new Error("create webhook config: no row returned");
    }
    return this.mapWebhookConfig(data);
  }

  async getConfig(serial: string): Promise<WebhookConfig | null> {
    return this.fetchConfigBy("serial", serial);
  }

  async getConfigByPhoneNumberId(phoneNumberId: string): Promise<WebhookConfig | null> {
    return this.fetchConfigBy("phone_number_id", phoneNumberId);
  }

  async listConfigs(): Promise<WebhookConfig[]> {
    const { data, error } = await this.client
      .from("webhook_configs")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`list webhook configs: ${error.message}`);
    }
    return (data ?? []).map((row) => this.mapWebhookConfig(row));
  }

  async updateConfig(
    serial: string,
    input: UpdateWebhookConfigInput,
  ): Promise<WebhookConfig> {
    const row: Record<string, unknown> = {};
    if (input.webhookUrl !== undefined) row.webhook_url = input.webhookUrl;
    if (input.webhookSecret !== undefined) row.webhook_secret = input.webhookSecret;
    if (input.enabled !== undefined) row.enabled = input.enabled;
    if (input.maxRetries !== undefined) row.max_retries = input.maxRetries;
    if (input.retryDelayMs !== undefined) row.retry_delay_ms = input.retryDelayMs;
    if (input.timeoutMs !== undefined) row.timeout_ms = input.timeoutMs;

    const { data, error } = await this.client
      .from("webhook_configs")
      .update(row)
      .eq("serial", serial)
      .select("*")
      .single();

    if (error) {
      throw new Error(`update webhook config: ${error.message}`);
    }
    if (data === null) {
      throw new Error("update webhook config: no row returned");
    }
    return this.mapWebhookConfig(data);
  }

  async deleteConfig(serial: string): Promise<void> {
    const { error } = await this.client
      .from("webhook_configs")
      .update({ deleted_at: new Date().toISOString() })
      .eq("serial", serial);

    if (error) {
      throw new Error(`delete webhook config: ${error.message}`);
    }
  }

  async listSubscriptions(configId: number): Promise<WebhookSubscription[]> {
    const { data, error } = await this.client
      .from("webhook_subscriptions")
      .select("*")
      .eq("webhook_config_id", configId)
      .order("created_at", { ascending: true });

    if (error) {
      throw new Error(`list webhook subscriptions: ${error.message}`);
    }
    return (data ?? []).map((row) => this.mapSubscription(row));
  }

  async addSubscription(configId: number, eventType: string): Promise<WebhookSubscription> {
    const { data, error } = await this.client
      .from("webhook_subscriptions")
      .insert({ webhook_config_id: configId, event_type: eventType })
      .select("*")
      .single();

    if (error) {
      // (webhook_config_id, event_type) is unique: a repeat add returns the
      // existing subscription instead of erroring (idempotent).
      if (UNIQUE_VIOLATION_CODES.has(String(error.code ?? ""))) {
        const existing = await this.fetchSubscriptionBy(configId, eventType);
        if (existing !== null) {
          return existing;
        }
      }
      throw new Error(`add webhook subscription: ${error.message}`);
    }
    if (data === null) {
      throw new Error("add webhook subscription: no row returned");
    }
    return this.mapSubscription(data);
  }

  async removeSubscription(configId: number, eventType: string): Promise<void> {
    const { error } = await this.client
      .from("webhook_subscriptions")
      .delete()
      .eq("webhook_config_id", configId)
      .eq("event_type", eventType);

    if (error) {
      throw new Error(`remove webhook subscription: ${error.message}`);
    }
  }

  /** Fetch a non-deleted webhook config row by a single column; null when absent. */
  private async fetchConfigBy(column: string, value: string): Promise<WebhookConfig | null> {
    const { data, error } = await this.client
      .from("webhook_configs")
      .select("*")
      .eq(column, value)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      throw new Error(`fetch webhook config by ${column}: ${error.message}`);
    }
    return data === null ? null : this.mapWebhookConfig(data);
  }

  /** Fetch a subscription by (config id, event type); null when absent. */
  private async fetchSubscriptionBy(
    configId: number,
    eventType: string,
  ): Promise<WebhookSubscription | null> {
    const { data, error } = await this.client
      .from("webhook_subscriptions")
      .select("*")
      .eq("webhook_config_id", configId)
      .eq("event_type", eventType)
      .maybeSingle();

    if (error) {
      throw new Error(`fetch webhook subscription: ${error.message}`);
    }
    return data === null ? null : this.mapSubscription(data);
  }

  private mapWebhookConfig(row: Record<string, unknown>): WebhookConfig {
    return {
      id: row.id as number,
      serial: row.serial as string,
      phoneNumberId: row.phone_number_id as string,
      webhookUrl: row.webhook_url as string,
      webhookSecret: (row.webhook_secret as string | null) ?? null,
      enabled: row.enabled as boolean,
      maxRetries: row.max_retries as number,
      retryDelayMs: row.retry_delay_ms as number,
      timeoutMs: row.timeout_ms as number,
      createdAt: row.created_at as string,
    };
  }

  private mapSubscription(row: Record<string, unknown>): WebhookSubscription {
    return {
      id: row.id as number,
      serial: row.serial as string,
      webhookConfigId: row.webhook_config_id as number,
      eventType: row.event_type as string,
      createdAt: row.created_at as string,
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
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      throw new Error(`fetch job by ${column}: ${error.message}`);
    }
    return data ?? null;
  }

  // ---------------------------------------------------------------------------
  // SessionTransport
  // ---------------------------------------------------------------------------

  async createSession(input: CreateSessionInput): Promise<string> {
    const row: Record<string, unknown> = {
      phone_number_id: input.phoneNumberId,
      number: input.number,
    };
    if (input.displayPhone !== undefined && input.displayPhone !== "") {
      row.display_phone = input.displayPhone;
    }
    if (input.businessAccountId !== undefined && input.businessAccountId !== "") {
      row.business_account_id = input.businessAccountId;
    }

    const { data, error } = await this.client
      .from("sessions")
      .insert(row)
      .select("serial")
      .single();

    if (error) {
      // phone_number_id is unique: a repeat create returns the existing serial
      // instead of erroring, so the caller stays idempotent.
      if (UNIQUE_VIOLATION_CODES.has(String(error.code ?? ""))) {
        const existing = await this.fetchSessionBy("phone_number_id", input.phoneNumberId);
        if (existing !== null) {
          return existing.serial;
        }
      }
      throw new Error(`create session: ${error.message}`);
    }
    if (data === null) {
      throw new Error("create session: no row returned");
    }
    return data.serial;
  }

  async getSession(serial: string): Promise<Session | null> {
    return this.fetchSessionBy("serial", serial);
  }

  async listSessions(): Promise<Session[]> {
    const { data, error } = await this.client
      .from("sessions")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`list sessions: ${error.message}`);
    }
    return (data ?? []).map((row) => this.mapSession(row));
  }

  async updateSessionStatus(serial: string, status: string): Promise<void> {
    const { error } = await this.client
      .from("sessions")
      .update({ status })
      .eq("serial", serial);

    if (error) {
      throw new Error(`update session status: ${error.message}`);
    }
  }

  async createPairingJob(phoneNumberId: string): Promise<string> {
    // `payload` is NOT NULL in the jobs table, so pairing jobs carry an empty
    // object; the worker distinguishes job types by `type`. The worker maps
    // sessions by phone_number_id, so no session_id column is stored.
    const { data, error } = await this.client
      .from("jobs")
      .insert({
        type: "pairing",
        phone_number_id: phoneNumberId,
        payload: {},
      })
      .select("serial")
      .single();

    if (error) {
      throw new Error(`create pairing job: ${error.message}`);
    }
    if (data === null) {
      throw new Error("create pairing job: no row returned");
    }
    return data.serial;
  }

  async createLogoutJob(phoneNumberId: string): Promise<string> {
    const { data, error } = await this.client
      .from("jobs")
      .insert({
        type: "logout",
        phone_number_id: phoneNumberId,
        payload: {},
      })
      .select("serial")
      .single();

    if (error) {
      throw new Error(`create logout job: ${error.message}`);
    }
    if (data === null) {
      throw new Error("create logout job: no row returned");
    }
    return data.serial;
  }

  async getLatestQrCode(sessionId: number): Promise<SessionQrCode | null> {
    const { data, error } = await this.client
      .from("session_qr_codes")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`get latest qr code: ${error.message}`);
    }
    if (data === null) {
      return null;
    }
    return this.mapQrCode(data);
  }

  async storeQrCode(
    sessionId: number,
    phoneNumberId: string,
    qrCode: string,
    expiresAt: Date,
  ): Promise<void> {
    const { error } = await this.client.from("session_qr_codes").insert({
      session_id: sessionId,
      phone_number_id: phoneNumberId,
      qr_code: qrCode,
      expires_at: expiresAt.toISOString(),
    });

    if (error) {
      throw new Error(`store qr code: ${error.message}`);
    }
  }

  async updateSessionHeartbeat(phoneNumberId: string): Promise<void> {
    // PostgREST does not evaluate SQL expressions in update values, so send an
    // ISO timestamp from the client rather than a literal `"now()"` string.
    const { error } = await this.client
      .from("sessions")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("phone_number_id", phoneNumberId);

    if (error) {
      throw new Error(`update session heartbeat: ${error.message}`);
    }
  }

  async getSessionByPhoneNumberId(phoneNumberId: string): Promise<Session | null> {
    return this.fetchSessionBy("phone_number_id", phoneNumberId);
  }

  /** Fetch a non-deleted session row by a single column; null when absent. */
  private async fetchSessionBy(column: string, value: string): Promise<Session | null> {
    const { data, error } = await this.client
      .from("sessions")
      .select("*")
      .eq(column, value)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      throw new Error(`fetch session by ${column}: ${error.message}`);
    }
    return data === null ? null : this.mapSession(data);
  }

  private mapSession(row: Record<string, unknown>): Session {
    return {
      id: row.id as number,
      serial: row.serial as string,
      phoneNumberId: row.phone_number_id as string,
      number: row.number as string,
      displayPhone: row.display_phone as string,
      businessAccountId: (row.business_account_id as string) ?? "",
      status: row.status as Session["status"],
      whatsappId: (row.whatsapp_id as string | null) ?? null,
      connectedAt: (row.connected_at as string | null) ?? null,
      lastSeenAt: (row.last_seen_at as string | null) ?? null,
      loggedOutAt: (row.logged_out_at as string | null) ?? null,
      createdAt: row.created_at as string,
    };
  }

  private mapQrCode(row: Record<string, unknown>): SessionQrCode {
    return {
      serial: row.serial as string,
      sessionId: row.session_id as number,
      phoneNumberId: row.phone_number_id as string,
      qrCode: row.qr_code as string,
      status: row.status as SessionQrCode["status"],
      expiresAt: row.expires_at as string,
      createdAt: row.created_at as string,
    };
  }
}

export { PostgrestClient };

/** Compile-time assertions (Go convention): SupabaseTransport implements all three ports. */
const _: JobTransport = undefined as unknown as SupabaseTransport;
const __: SessionTransport = undefined as unknown as SupabaseTransport;
const ___ : WebhookConfigManagementTransport = undefined as unknown as SupabaseTransport;
