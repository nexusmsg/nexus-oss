/**
 * Drizzle ORM-backed implementation of the driven ports.
 *
 * Implements:
 * - JobTransport
 * - SessionTransport
 * - WebhookConfigManagementTransport
 *
 * Uses the postgres driver directly via Drizzle, talking to the same DB
 * that services/api used via PostgREST.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "./client";
import type { CreateSessionInput, Session, SessionQrCode } from "../../domain/session";
import type { WebhookConfig, WebhookSubscription } from "../../domain/webhook-config";
import type { EnqueueInput, JobTransport, PollResult } from "../../ports/job-transport";
import type { SessionTransport } from "../../ports/session-transport";
import type {
  CreateWebhookConfigInput,
  UpdateWebhookConfigInput,
  WebhookConfigManagementTransport,
} from "../../ports/webhook-config-management";
import {
  jobs,
  sessionQrCodes,
  sessions,
  webhookConfigs,
  webhookSubscriptions,
  whatsmeowJobs,
} from "@shared/db/schema";

const UNIQUE_VIOLATION_CODE = "23505";

export class DrizzleTransport
  implements JobTransport, SessionTransport, WebhookConfigManagementTransport
{
  // ---------------------------------------------------------------------------
  // JobTransport
  // ---------------------------------------------------------------------------

  async enqueue({ phoneNumberId, payload, idempotencyKey }: EnqueueInput): Promise<string> {
    const db = getDb();

    // Check for existing job with same idempotency key (idempotent)
    if (idempotencyKey !== undefined && idempotencyKey !== "") {
      const existing = await db
        .select({ serial: jobs.serial })
        .from(jobs)
        .where(and(eq(jobs.idempotencyKey, idempotencyKey), isNull(jobs.deletedAt)))
        .limit(1);

      if (existing.length > 0) {
        return existing[0].serial;
      }
    }

    const [row] = await db
      .insert(jobs)
      .values({
        type: "send_message",
        phoneNumberId,
        payload,
        idempotencyKey: idempotencyKey || null,
      })
      .returning({ serial: jobs.serial });

    if (!row) {
      throw new Error("enqueue job: no row returned");
    }
    return row.serial;
  }

  async poll(serial: string): Promise<PollResult | null> {
    const db = getDb();
    const [row] = await db
      .select({
        status: jobs.status,
        result: jobs.result,
        lastError: jobs.lastError,
      })
      .from(jobs)
      .where(and(eq(jobs.serial, serial), isNull(jobs.deletedAt)))
      .limit(1);

    if (!row) {
      return null;
    }
    return {
      status: row.status,
      result: row.result,
      lastError: row.lastError,
    };
  }

  async getWebhookConfig(phoneNumberId: string): Promise<WebhookConfig | null> {
    const db = getDb();
    const [row] = await db
      .select()
      .from(webhookConfigs)
      .where(
        and(
          eq(webhookConfigs.phoneNumberId, phoneNumberId),
          isNull(webhookConfigs.deletedAt),
        ),
      )
      .limit(1);

    if (!row) {
      return null;
    }
    return this.mapWebhookConfig(row);
  }

  // ---------------------------------------------------------------------------
  // SessionTransport
  // ---------------------------------------------------------------------------

  async createSession(input: CreateSessionInput): Promise<string> {
    const db = getDb();

    // Check for existing session with same phone_number_id (idempotent)
    const existing = await db
      .select({ serial: sessions.serial })
      .from(sessions)
      .where(
        and(
          eq(sessions.phoneNumberId, input.phoneNumberId),
          isNull(sessions.deletedAt),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      return existing[0].serial;
    }

    const [row] = await db
      .insert(sessions)
      .values({
        phoneNumberId: input.phoneNumberId,
        number: input.number,
        displayPhone: input.displayPhone ?? "",
        businessAccountId: input.businessAccountId ?? "",
      })
      .returning({ serial: sessions.serial });

    if (!row) {
      throw new Error("create session: no row returned");
    }
    return row.serial;
  }

  async getSession(serial: string): Promise<Session | null> {
    return this.fetchSessionBy("serial", serial);
  }

  async listSessions(): Promise<Session[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(sessions)
      .where(isNull(sessions.deletedAt))
      .orderBy(desc(sessions.createdAt));

    return rows.map((row) => this.mapSession(row));
  }

  async updateSessionStatus(serial: string, status: string): Promise<void> {
    const db = getDb();
    await db
      .update(sessions)
      .set({ status: status as Session["status"] })
      .where(eq(sessions.serial, serial));
  }

  async createPairingJob(phoneNumberId: string): Promise<string> {
    const db = getDb();
    const [row] = await db
      .insert(jobs)
      .values({
        type: "pairing",
        phoneNumberId,
        payload: {},
      })
      .returning({ serial: jobs.serial });

    if (!row) {
      throw new Error("create pairing job: no row returned");
    }
    return row.serial;
  }

  async createLogoutJob(phoneNumberId: string): Promise<string> {
    const db = getDb();
    const [row] = await db
      .insert(jobs)
      .values({
        type: "logout",
        phoneNumberId,
        payload: {},
      })
      .returning({ serial: jobs.serial });

    if (!row) {
      throw new Error("create logout job: no row returned");
    }
    return row.serial;
  }

  async getLatestQrCode(sessionId: number): Promise<SessionQrCode | null> {
    const db = getDb();
    const [row] = await db
      .select()
      .from(sessionQrCodes)
      .where(eq(sessionQrCodes.sessionId, sessionId))
      .orderBy(desc(sessionQrCodes.createdAt))
      .limit(1);

    if (!row) {
      return null;
    }
    return this.mapQrCode(row);
  }

  async getQrCodeByJobSerial(jobSerial: string): Promise<SessionQrCode | null> {
    const db = getDb();
    const [row] = await db
      .select()
      .from(sessionQrCodes)
      .where(eq(sessionQrCodes.jobSerial, jobSerial))
      .orderBy(desc(sessionQrCodes.createdAt))
      .limit(1);

    if (!row) {
      return null;
    }
    return this.mapQrCode(row);
  }

  async storeQrCode(
    sessionId: number,
    phoneNumberId: string,
    qrCode: string,
    expiresAt: Date,
  ): Promise<void> {
    const db = getDb();
    await db.insert(sessionQrCodes).values({
      sessionId,
      phoneNumberId,
      qrCode,
      expiresAt,
    });
  }

  async updateSessionHeartbeat(phoneNumberId: string): Promise<void> {
    const db = getDb();
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(sessions.phoneNumberId, phoneNumberId));
  }

  async getSessionByPhoneNumberId(phoneNumberId: string): Promise<Session | null> {
    return this.fetchSessionBy("phoneNumberId", phoneNumberId);
  }

  async deleteSession(serial: string): Promise<boolean> {
    const db = getDb();
    const result = await db
      .update(sessions)
      .set({ deletedAt: new Date() })
      .where(and(eq(sessions.serial, serial), isNull(sessions.deletedAt)))
      .returning({ serial: sessions.serial });
    return result.length > 0;
  }

  /** Fetch a non-deleted session row by a single column; null when absent. */
  private async fetchSessionBy(
    column: "serial" | "phoneNumberId",
    value: string,
  ): Promise<Session | null> {
    const db = getDb();
    const [row] = await db
      .select()
      .from(sessions)
      .where(
        and(
          column === "serial"
            ? eq(sessions.serial, value)
            : eq(sessions.phoneNumberId, value),
          isNull(sessions.deletedAt),
        ),
      )
      .limit(1);

    if (!row) {
      return null;
    }
    return this.mapSession(row);
  }

  private mapSession(row: typeof sessions.$inferSelect): Session {
    return {
      id: row.id,
      serial: row.serial as unknown as string,
      phoneNumberId: row.phoneNumberId,
      number: row.number,
      displayPhone: row.displayPhone,
      businessAccountId: row.businessAccountId,
      status: row.status as Session["status"],
      whatsappId: row.whatsappId as string | null,
      connectedAt: row.connectedAt ? String(row.connectedAt) : null,
      lastSeenAt: row.lastSeenAt ? String(row.lastSeenAt) : null,
      loggedOutAt: row.loggedOutAt ? String(row.loggedOutAt) : null,
      createdAt: String(row.createdAt),
    };
  }

  private mapQrCode(row: typeof sessionQrCodes.$inferSelect): SessionQrCode {
    return {
      serial: row.serial as unknown as string,
      sessionId: Number(row.sessionId),
      phoneNumberId: row.phoneNumberId,
      qrCode: row.qrCode,
      status: row.status as SessionQrCode["status"],
      expiresAt: String(row.expiresAt),
      jobSerial: row.jobSerial as string | null,
      createdAt: String(row.createdAt),
    };
  }

  // ---------------------------------------------------------------------------
  // WebhookConfigManagementTransport
  // ---------------------------------------------------------------------------

  async createConfig(input: CreateWebhookConfigInput): Promise<WebhookConfig> {
    const db = getDb();

    // Check for existing config with same phone_number_id (idempotent)
    const existing = await db
      .select()
      .from(webhookConfigs)
      .where(
        and(
          eq(webhookConfigs.phoneNumberId, input.phoneNumberId),
          isNull(webhookConfigs.deletedAt),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      return this.mapWebhookConfig(existing[0]);
    }

    const [row] = await db
      .insert(webhookConfigs)
      .values({
        phoneNumberId: input.phoneNumberId,
        webhookUrl: input.webhookUrl,
        webhookSecret: input.webhookSecret ?? null,
      })
      .returning();

    if (!row) {
      throw new Error("create webhook config: no row returned");
    }
    return this.mapWebhookConfig(row);
  }

  async getConfig(serial: string): Promise<WebhookConfig | null> {
    return this.fetchConfigBy("serial", serial);
  }

  async getConfigByPhoneNumberId(phoneNumberId: string): Promise<WebhookConfig | null> {
    return this.fetchConfigBy("phoneNumberId", phoneNumberId);
  }

  async listConfigs(): Promise<WebhookConfig[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(webhookConfigs)
      .where(isNull(webhookConfigs.deletedAt))
      .orderBy(desc(webhookConfigs.createdAt));

    return rows.map((row) => this.mapWebhookConfig(row));
  }

  async updateConfig(
    serial: string,
    input: UpdateWebhookConfigInput,
  ): Promise<WebhookConfig> {
    const db = getDb();
    const updates: Record<string, unknown> = {};

    if (input.webhookUrl !== undefined) updates.webhookUrl = input.webhookUrl;
    if (input.webhookSecret !== undefined)
      updates.webhookSecret = input.webhookSecret;
    if (input.enabled !== undefined) updates.enabled = input.enabled;
    if (input.maxRetries !== undefined) updates.maxRetries = input.maxRetries;
    if (input.retryDelayMs !== undefined)
      updates.retryDelayMs = input.retryDelayMs;
    if (input.timeoutMs !== undefined) updates.timeoutMs = input.timeoutMs;

    const [row] = await db
      .update(webhookConfigs)
      .set(updates)
      .where(eq(webhookConfigs.serial, serial))
      .returning();

    if (!row) {
      throw new Error("update webhook config: no row returned");
    }
    return this.mapWebhookConfig(row);
  }

  async deleteConfig(serial: string): Promise<void> {
    const db = getDb();
    await db
      .update(webhookConfigs)
      .set({ deletedAt: new Date() })
      .where(eq(webhookConfigs.serial, serial));
  }

  async listSubscriptions(configId: number): Promise<WebhookSubscription[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.webhookConfigId, configId))
      .orderBy(webhookSubscriptions.createdAt);

    return rows.map((row) => this.mapSubscription(row));
  }

  async addSubscription(
    configId: number,
    eventType: string,
  ): Promise<WebhookSubscription> {
    const db = getDb();

    // Check for existing subscription (idempotent)
    const existing = await db
      .select()
      .from(webhookSubscriptions)
      .where(
        and(
          eq(webhookSubscriptions.webhookConfigId, configId),
          eq(webhookSubscriptions.eventType, eventType),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      return this.mapSubscription(existing[0]);
    }

    const [row] = await db
      .insert(webhookSubscriptions)
      .values({
        webhookConfigId: configId,
        eventType,
      })
      .returning();

    if (!row) {
      throw new Error("add webhook subscription: no row returned");
    }
    return this.mapSubscription(row);
  }

  async removeSubscription(configId: number, eventType: string): Promise<void> {
    const db = getDb();
    await db
      .delete(webhookSubscriptions)
      .where(
        and(
          eq(webhookSubscriptions.webhookConfigId, configId),
          eq(webhookSubscriptions.eventType, eventType),
        ),
      );
  }

  /** Fetch a non-deleted webhook config row by a single column; null when absent. */
  private async fetchConfigBy(
    column: "serial" | "phoneNumberId",
    value: string,
  ): Promise<WebhookConfig | null> {
    const db = getDb();
    const [row] = await db
      .select()
      .from(webhookConfigs)
      .where(
        and(
          column === "serial"
            ? eq(webhookConfigs.serial, value)
            : eq(webhookConfigs.phoneNumberId, value),
          isNull(webhookConfigs.deletedAt),
        ),
      )
      .limit(1);

    if (!row) {
      return null;
    }
    return this.mapWebhookConfig(row);
  }

  private mapWebhookConfig(
    row: typeof webhookConfigs.$inferSelect,
  ): WebhookConfig {
    return {
      id: row.id,
      serial: row.serial as unknown as string,
      phoneNumberId: row.phoneNumberId,
      webhookUrl: row.webhookUrl,
      webhookSecret: row.webhookSecret as string | null,
      enabled: row.enabled,
      maxRetries: row.maxRetries,
      retryDelayMs: row.retryDelayMs,
      timeoutMs: row.timeoutMs,
      createdAt: String(row.createdAt),
    };
  }

  private mapSubscription(
    row: typeof webhookSubscriptions.$inferSelect,
  ): WebhookSubscription {
    return {
      id: row.id,
      serial: row.serial as unknown as string,
      webhookConfigId: Number(row.webhookConfigId),
      eventType: row.eventType,
      createdAt: String(row.createdAt),
    };
  }
}

/** Compile-time assertions: DrizzleTransport implements all three ports. */
const _: JobTransport = undefined as unknown as DrizzleTransport;
const __: SessionTransport = undefined as unknown as DrizzleTransport;
const ___: WebhookConfigManagementTransport =
  undefined as unknown as DrizzleTransport;
