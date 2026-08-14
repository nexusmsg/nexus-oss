/**
 * Driven port: persistence access for the observability activity log. The
 * Drizzle adapter implements it; the application layer (ObservabilityService)
 * depends on it.
 *
 * Correlation columns follow the no-FK `source_job_serial` pattern; rows are
 * append-only (no update/delete). Queries use the 000013 indexes: created_at
 * desc/type, phone_number_id, job_serial, wa_message_id, source_activity_serial,
 * and resource_serial partials.
 */

import type {
  ActivityListFilters,
  ActivityResourceType,
  ActivityStatus,
  ActivityType,
} from "../domain/observability";

/** Persisted row as returned by the transport (createdAt is a Date). */
export interface ActivityRow {
  serial: string;
  type: ActivityType;
  status: ActivityStatus;
  phoneNumberId: string | null;
  businessAccountId: string;
  summary: string;
  jobSerial: string | null;
  waMessageId: string | null;
  sourceActivitySerial: string | null;
  resourceType: ActivityResourceType | null;
  resourceSerial: string | null;
  requestSerial: string | null;
  payload: unknown;
  createdAt: Date;
}

/** A row to insert. `serial` may be omitted (generated if absent). */
export interface ActivityInsertRow {
  serial?: string;
  type: ActivityType;
  status: ActivityStatus;
  phoneNumberId?: string | null;
  businessAccountId?: string;
  summary?: string;
  jobSerial?: string | null;
  waMessageId?: string | null;
  sourceActivitySerial?: string | null;
  resourceType?: ActivityResourceType | null;
  resourceSerial?: string | null;
  requestSerial?: string | null;
  payload?: unknown;
}

export interface ActivityTransport {
  /** INSERT an activity row; returns its `serial`. */
  insert(row: ActivityInsertRow): Promise<string>;
  /** List rows newest-first with optional type/status/phone filters. */
  list(filters: ActivityListFilters): Promise<ActivityRow[]>;
  /** Fetch a row by serial; null when absent. */
  getBySerial(serial: string): Promise<ActivityRow | null>;
  /**
   * Resolve related rows for a serial per plan §5: any row sharing a
   * correlation column (job_serial, wa_message_id, resource_serial), plus the
   * two sides of the chain (source_activity_serial and anything pointing at
   * this row). Excludes the row itself.
   */
  listRelated(serial: string): Promise<ActivityRow[]>;
}
