/**
 * Drizzle ORM schema for the waba-api database.
 * Mirrors the SQL migrations in shared/db/migrations/.
 *
 * Generated from:
 * - 000001_create_jobs
 * - 000002_create_webhook_configs
 * - 000003_create_sessions + session_qr_codes
 * - 000004_webhook_management (webhook_subscriptions + extensions to webhook_configs)
 * - 000005_add_business_account_id_to_sessions
 * - 000006 (intentional gap in the migration sequence)
 * - 000007_create_whatsmeow_jobs
 * - 000008_add_qr_job_serial
 * - 000009_allow_reuse_deleted_session_phone_number
 * - 000010_allow_reuse_deleted_webhook_config_phone_number
 * - 000011_create_api_keys
 */

import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  pgTable,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ============================================================================
// Jobs (000001)
// ============================================================================

export const jobs = pgTable(
  "jobs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    serial: uuid("serial").notNull().defaultRandom(),
    type: text("type").notNull().default("send_message"),
    phoneNumberId: text("phone_number_id").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status")
      .notNull()
      .default("pending")
      .$type<"pending" | "claimed" | "succeeded" | "failed">(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    claimedBy: text("claimed_by"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastError: text("last_error"),
    result: jsonb("result"),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    serialIdx: uniqueIndex("jobs_serial_idx").on(table.serial),
    idempotencyKeyIdx: uniqueIndex("jobs_idempotency_key_idx")
      .on(table.idempotencyKey)
      .where(sql`idempotency_key IS NOT NULL`),
    claimIdx: index("jobs_claim_idx").on(table.status, table.availableAt, table.createdAt),
  }),
);

// ============================================================================
// Webhook Configs (000002 + 000004 extensions)
// ============================================================================

export const webhookConfigs = pgTable(
  "webhook_configs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    serial: uuid("serial").notNull().defaultRandom(),
    phoneNumberId: text("phone_number_id").notNull().unique(),
    webhookUrl: text("webhook_url").notNull(),
    webhookSecret: text("webhook_secret"),
    enabled: boolean("enabled").notNull().default(true),
    maxRetries: integer("max_retries").notNull().default(3),
    retryDelayMs: integer("retry_delay_ms").notNull().default(1000),
    timeoutMs: integer("timeout_ms").notNull().default(10000),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    serialIdx: uniqueIndex("webhook_configs_serial_idx").on(table.serial),
  }),
);

// ============================================================================
// Sessions (000003 + 000005 business_account_id)
// ============================================================================

export const sessions = pgTable(
  "sessions",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    serial: uuid("serial").notNull().defaultRandom(),
    phoneNumberId: text("phone_number_id").notNull().unique(),
    number: text("number").notNull(),
    displayPhone: text("display_phone").notNull().default(""),
    status: text("status")
      .notNull()
      .default("created")
      .$type<"created" | "pairing" | "connected" | "disconnected" | "logged_out">(),
    whatsappId: text("whatsapp_id"),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    loggedOutAt: timestamp("logged_out_at", { withTimezone: true }),
    businessAccountId: text("business_account_id").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    serialIdx: uniqueIndex("sessions_serial_idx").on(table.serial),
  }),
);

// ============================================================================
// Session QR Codes (000003 + 000008 job_serial)
// ============================================================================

export const sessionQrCodes = pgTable(
  "session_qr_codes",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    serial: uuid("serial").notNull().defaultRandom(),
    sessionId: bigint("session_id", { mode: "number" })
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    phoneNumberId: text("phone_number_id").notNull(),
    qrCode: text("qr_code").notNull(),
    status: text("status")
      .notNull()
      .default("pending")
      .$type<"pending" | "ready" | "expired">(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Links the QR row back to the pairing job that produced it (migration
    // 000008). Nullable: rows written before the column existed stay valid,
    // and rows from non-job paths (e.g. dashboard-initiated pairing via a
    // future flow) can omit it.
    jobSerial: uuid("job_serial"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    serialIdx: uniqueIndex("session_qr_codes_serial_idx").on(table.serial),
    sessionIdx: index("session_qr_codes_session_idx").on(
      table.sessionId,
      table.createdAt,
    ),
    jobSerialIdx: index("session_qr_codes_job_serial_idx")
      .on(table.jobSerial)
      .where(sql`job_serial IS NOT NULL`),
  }),
);

// ============================================================================
// Webhook Subscriptions (000004)
// ============================================================================

export const webhookSubscriptions = pgTable(
  "webhook_subscriptions",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    serial: uuid("serial").notNull().defaultRandom(),
    webhookConfigId: bigint("webhook_config_id", { mode: "number" })
      .notNull()
      .references(() => webhookConfigs.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    serialIdx: uniqueIndex("webhook_subscriptions_serial_idx").on(table.serial),
    configEventIdx: uniqueIndex("webhook_subscriptions_config_event_idx").on(
      table.webhookConfigId,
      table.eventType,
    ),
  }),
);

// ============================================================================
// Whatsmeow Jobs (000007)
// ============================================================================

export const whatsmeowJobs = pgTable(
  "whatsmeow_jobs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    serial: uuid("serial").notNull().defaultRandom(),
    // No FK to jobs.serial — jobs row may be GC'd independently
    sourceJobSerial: uuid("source_job_serial"),
    type: text("type").notNull().default("send_message"),
    phoneNumberId: text("phone_number_id").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status")
      .notNull()
      .default("pending")
      .$type<"pending" | "claimed" | "succeeded" | "failed">(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    claimedBy: text("claimed_by"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastError: text("last_error"),
    result: jsonb("result"),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    serialIdx: uniqueIndex("whatsmeow_jobs_serial_idx").on(table.serial),
    idempotencyKeyIdx: uniqueIndex("whatsmeow_jobs_idempotency_key_idx")
      .on(table.idempotencyKey)
      .where(sql`idempotency_key IS NOT NULL`),
    claimIdx: index("whatsmeow_jobs_claim_idx").on(
      table.status,
      table.availableAt,
      table.createdAt,
    ),
    sourceIdx: index("whatsmeow_jobs_source_idx")
      .on(table.sourceJobSerial)
      .where(sql`source_job_serial IS NOT NULL`),
  }),
);

// ============================================================================
// API Keys (000011)
// ============================================================================

export const apiKeys = pgTable(
  "api_keys",
  {
    // serial doubles as the primary key: api_keys rows are global (no tenant
    // identity) and referenced only by serial or hash, never by a numeric FK.
    serial: uuid("serial").notNull().defaultRandom().primaryKey(),
    name: text("name").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    // Nullable AES-256-GCM envelope of the full key secret, enabling on-demand
    // reveal. NULL = pre-migration key whose plaintext was never persisted.
    // `keyHash` remains the authentication lookup; this column is additive.
    keyCiphertext: text("key_ciphertext"),
    scope: text("scope")
      .notNull()
      .default("read")
      .$type<"read" | "write" | "full">(),
    status: text("status")
      .notNull()
      .default("active")
      .$type<"active" | "revoked">(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    keyHashIdx: uniqueIndex("api_keys_key_hash_idx").on(table.keyHash),
    statusIdx: index("api_keys_status_idx")
      .on(table.status)
      .where(sql`deleted_at IS NULL`),
  }),
);

// Type exports for domain use
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type SessionQrCode = typeof sessionQrCodes.$inferSelect;
export type NewSessionQrCode = typeof sessionQrCodes.$inferInsert;
export type WebhookConfig = typeof webhookConfigs.$inferSelect;
export type NewWebhookConfig = typeof webhookConfigs.$inferInsert;
export type WebhookSubscription = typeof webhookSubscriptions.$inferSelect;
export type NewWebhookSubscription = typeof webhookSubscriptions.$inferInsert;
export type WhatsmeowJob = typeof whatsmeowJobs.$inferSelect;
export type NewWhatsmeowJob = typeof whatsmeowJobs.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
