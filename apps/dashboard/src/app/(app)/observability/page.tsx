"use client";

import { ActivityLog } from "@/components/ActivityLog";
import { useActivities } from "@/lib/hooks/useActivities";

/* ── Activity List Page ─────────────────────────────────────
 * Renders the observability activity log against the live
 * `/api/v1/observability` endpoint via the `useActivities` hook.
 * Type filtering happens client-side inside `ActivityLog`.
 * ─────────────────────────────────────────────────────────── */

export default function ObservabilityPage() {
  const { data, loading, error, refresh } = useActivities();

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Activity</h1>
          <p className="mt-1 text-sm text-muted">
            Every API request, WhatsApp event, and webhook delivery
          </p>
        </div>
      </div>

      <ActivityLog
        activities={data}
        loading={loading}
        error={error}
        onRefresh={() => void refresh()}
      />
    </>
  );
}
