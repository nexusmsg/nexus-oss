/**
 * Observability domain types for the developer dashboard activity log.
 * Pure domain: no Next.js, Drizzle, or node imports.
 *
 * Mirrors the `activity_events` table (migration 000013). The wire view-model
 * (`ActivityEventView`) is what the future GET endpoints (T6) and the UI (T8)
 * receive; the persistence row shape lives in the `ActivityTransport` port.
 *
 * Correlation columns follow the existing no-FK `source_job_serial` pattern:
 * uuid links point at serials in other tables with no referential constraint.
 */

/** Type discriminator, matches the `activity_events.type` CHECK. */
export type ActivityType = "api_request" | "whatsapp_event" | "webhook_delivery";

/** Status value, matches the `activity_events.status` CHECK. */
export type ActivityStatus = "ok" | "error" | "attempted";

/** Resource kind for `resource_type` (sessions/webhook_configs/api_keys/jobs). */
export type ActivityResourceType = "session" | "webhook_config" | "api_key" | "job";

/**
 * Wire view-model of a single activity row. `createdAt` is an ISO string (the
 * transport stores a `Date`; the wire shape is stringified like every other
 * dashboard list/table row). Nullable correlation columns are normalized to
 * `string | null` so the UI can branch without `undefined` checks.
 */
export interface ActivityEventView {
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
  /** api_key serial, the literal "bootstrap", or null when unauthenticated. */
  requestSerial: string | null;
  /** Kind-specific detail (see plan §3). Loosely typed on the wire. */
  payload: unknown;
  createdAt: string;
}

/** Filters for the list endpoint (type/status/phone; newest first). */
export interface ActivityListFilters {
  type?: ActivityType;
  status?: ActivityStatus;
  phoneNumberId?: string;
  /** Max rows to return (transport applies a sane default). */
  limit?: number;
}

/** Detail shape: the activity plus its resolvable related rows (plan §5). */
export interface ActivityDetail {
  activity: ActivityEventView;
  related: ActivityEventView[];
}

/**
 * Wire envelopes for the future GET endpoints (T6). The service returns the
 * domain shapes; the route adapter wraps them in these envelopes to match the
 * existing WABA-flavored response convention. Declared here so the contract is
 * fixed before the routes exist.
 */
export interface ActivityListResponse {
  activities: ActivityEventView[];
}

export interface ActivityDetailResponse {
  activity: ActivityEventView;
  related: ActivityEventView[];
}

/**
 * Activity-context contract (plan §10 R1). A future capture wrapper (T7) owns
 * an instance and passes it into the wrapped route handler. The handler reports
 * an enqueued `job_serial` out-of-band via `setJobSerial`; the wrapper reads
 * `jobSerial` after the handler returns and attaches it to the recorded
 * activity row, without the handler needing to return it explicitly.
 *
 * Implemented in T7; defined here so handlers can depend on the contract.
 */
export interface ActivityContext {
  /** Called by a wrapped handler to report an enqueued job serial. */
  setJobSerial(serial: string): void;
  /** The reported job serial, or null if the handler reported none. */
  readonly jobSerial: string | null;
}
