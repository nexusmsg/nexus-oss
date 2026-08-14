/**
 * Application service implementing the observability activity log. Maps
 * persistence rows to wire view-models, filters list queries, resolves related
 * activity, and exposes a fire-and-forget `record` path for the future capture
 * wrapper (T7). Imports only domain + ports.
 *
 * R4 (plan §10): `record` returns a Promise and must never throw synchronously;
 * callers invoke it `void service.record(...).catch(log)` after the response is
 * built. The transport's `insert` is the only await; a synchronous throw is not
 * possible because the work is lazy, so the contract holds without a wrapper.
 */

import type {
  ActivityDetail,
  ActivityEventView,
  ActivityListFilters,
  ActivityListResponse,
  ActivityDetailResponse,
} from "../domain/observability";
import type {
  ActivityInsertRow,
  ActivityRow,
  ActivityTransport,
} from "../ports/activity-transport";

/** Application-facing port for observability (HTTP adapter depends on this). */
export interface ObservabilityServicePort {
  /** List activities newest-first with optional type/status/phone filters. */
  list(filters: ActivityListFilters): Promise<ActivityListResponse>;
  /** Fetch one activity plus its related rows; null when the serial is absent. */
  detail(serial: string): Promise<ActivityDetailResponse | null>;
  /** Fire-and-forget insert path for the future capture wrapper (R4). */
  record(row: ActivityInsertRow): Promise<string>;
}

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 1000;

export class ObservabilityService implements ObservabilityServicePort {
  private readonly transport: ActivityTransport;

  constructor(transport: ActivityTransport) {
    this.transport = transport;
  }

  async list(filters: ActivityListFilters): Promise<ActivityListResponse> {
    const rows = await this.transport.list({
      type: filters.type,
      status: filters.status,
      phoneNumberId: filters.phoneNumberId,
      limit: clampLimit(filters.limit),
    });
    return { activities: rows.map(mapRow) };
  }

  async detail(serial: string): Promise<ActivityDetailResponse | null> {
    const activity = await this.transport.getBySerial(serial);
    if (activity === null) {
      return null;
    }
    const relatedRows = await this.transport.listRelated(serial);
    const related = relatedRows.map(mapRow);
    const detail: ActivityDetail = { activity: mapRow(activity), related };
    return { activity: detail.activity, related: detail.related };
  }

  async record(row: ActivityInsertRow): Promise<string> {
    return this.transport.insert(row);
  }
}

/** Map a persistence row (Date createdAt) to the wire view-model (string). */
export function mapRow(row: ActivityRow): ActivityEventView {
  return {
    serial: row.serial,
    type: row.type,
    status: row.status,
    phoneNumberId: row.phoneNumberId,
    businessAccountId: row.businessAccountId,
    summary: row.summary,
    jobSerial: row.jobSerial,
    waMessageId: row.waMessageId,
    sourceActivitySerial: row.sourceActivitySerial,
    resourceType: row.resourceType,
    resourceSerial: row.resourceSerial,
    requestSerial: row.requestSerial,
    payload: row.payload,
    createdAt: String(row.createdAt),
  };
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_LIST_LIMIT;
  }
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIST_LIMIT);
}

/** Compile-time assertion (Go convention): service implements the app port. */
const _: ObservabilityServicePort = undefined as unknown as ObservabilityService;
