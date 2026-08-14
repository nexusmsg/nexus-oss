/* ── Observability API ──
 *
 * Typed functions for the `/api/v1/observability*` routes served by
 * `apps/dashboard` (Next.js route handlers). All errors surface as `ApiError`
 * with the WABA envelope normalized by the client.
 *
 * Bootstrap-only endpoints: callers must send the bootstrap `API_AUTH_TOKEN`
 * (resolved by the client's auth strategy); persisted API keys are rejected by
 * the server.
 */

import { apiGet } from "./client";
import type {
  ActivitiesListResponse,
  ActivityDetailResponse,
  ActivityEvent,
  ActivityListFilters,
} from "./types";

/** Build the query string for list filters (skipping undefined values). */
function listQuery(filters?: ActivityListFilters): string {
  if (!filters) return "";
  const sp = new URLSearchParams();
  if (filters.type !== undefined) sp.set("type", filters.type);
  if (filters.status !== undefined) sp.set("status", filters.status);
  if (filters.phoneNumberId !== undefined) sp.set("phone_number_id", filters.phoneNumberId);
  if (filters.limit !== undefined) sp.set("limit", String(filters.limit));
  const qs = sp.toString();
  return qs === "" ? "" : `?${qs}`;
}

/** List activities newest-first, optionally filtered (bootstrap auth required). */
export async function listActivities(
  filters?: ActivityListFilters,
): Promise<ActivityEvent[]> {
  const res = await apiGet<ActivitiesListResponse>(
    `/api/v1/observability${listQuery(filters)}`,
  );
  return res.activities;
}

/** Fetch one activity plus its related rows (bootstrap auth required). */
export async function getActivity(serial: string): Promise<ActivityDetailResponse> {
  return apiGet<ActivityDetailResponse>(
    `/api/v1/observability/${encodeURIComponent(serial)}`,
  );
}
