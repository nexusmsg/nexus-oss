"use client";

/* ── Activity list hook ──
 *
 * `useActivities` loads the observability activity log (newest-first) and
 * exposes a manual `refresh`. The list endpoint is bootstrap-only, so this
 * works without a persisted API key.
 *
 * All network access goes through the typed observability module
 * (`src/lib/api/observability.ts`), which uses the shared client's `apiGet`
 * and normalizes failures into `ApiError`. Types come from `src/lib/api/types.ts`.
 *
 * Pattern mirrors `useApiKeys`: plain `useState`/`useEffect`/`useCallback`
 * with `mountedRef` (no data-fetching library). Returns `data`, `loading`,
 * `error`, and `refresh` per the PRD technical definition.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { listActivities } from "@/lib/api/observability";
import type { ActivityEvent } from "@/lib/api/types";

/* Convenience re-export so hook consumers can import the row type here. */
export type { ActivityEvent } from "@/lib/api/types";

export interface UseActivitiesReturn {
  data: ActivityEvent[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useActivities(): UseActivitiesReturn {
  const [data, setData] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    // Guarded: continuations may resolve after unmount.
    if (!mountedRef.current) return;
    setError(null);
    try {
      const activities = await listActivities();
      if (mountedRef.current) {
        setData(activities);
        setLoading(false);
      }
    } catch (e) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : "Failed to load activities");
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch, guarded by mountedRef
    void refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  return { data, loading, error, refresh };
}