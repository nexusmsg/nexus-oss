"use client";

import { ActivityLog } from "@/components/ActivityLog";

/* ── Activity List Page ─────────────────────────────────────
 * Renders the observability activity log. Uses dummy data for now;
 * swap `ActivityLog` props to the `useActivities` hook once the UI is
 * integrated with the live `/api/v1/observability` endpoint.
 * ─────────────────────────────────────────────────────────── */

export default function ObservabilityPage() {
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

      <ActivityLog />
    </>
  );
}
