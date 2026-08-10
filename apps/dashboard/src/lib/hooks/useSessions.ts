"use client";

/* ── Sessions list hook + status poll helper ──
 *
 * `useSessions` loads the session list and exposes a manual `refresh`.
 * `pollStatus` is the small helper the logout flow uses: poll
 * `GET /sessions/:serial/status` every 3s until a target status (or timeout).
 * No data-library dependency — plain state/effects with unmount guarding.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { listSessions, getSessionStatus } from "@/lib/api/sessions";
import { ApiError } from "@/lib/api/types";
import type { Session, SessionStatus } from "@/lib/api/types";

export interface UseSessionsReturn {
  sessions: Session[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  pollStatus: (
    serial: string,
    until: SessionStatus,
    timeoutMs?: number,
  ) => Promise<SessionStatus>;
}

const POLL_INTERVAL_MS = 3_000;
const STATUS_POLL_TIMEOUT_MS = 15_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll `GET /sessions/:serial/status` until `until`, polling every 3s.
 * Resolves with the reached status; rejects with `ApiError` when the
 * `timeoutMs` deadline passes without reaching it.
 */
export async function pollStatus(
  serial: string,
  until: SessionStatus,
  timeoutMs: number = STATUS_POLL_TIMEOUT_MS,
): Promise<SessionStatus> {
  const deadline = Date.now() + timeoutMs;
  // Keep the poll cadence sane relative to short test timeouts.
  const intervalMs = Math.min(POLL_INTERVAL_MS, Math.max(250, timeoutMs / 3));

  for (;;) {
    let status: SessionStatus;
    try {
      status = await getSessionStatus(serial);
    } catch {
      // Transient request error — keep polling until the deadline.
      if (Date.now() >= deadline) {
        throw new ApiError(
          0,
          `Timed out after ${timeoutMs}ms waiting for session status "${until}"`,
        );
      }
      await sleep(intervalMs);
      continue;
    }

    if (status === until) return status;

    if (Date.now() >= deadline) {
      throw new ApiError(
        0,
        `Timed out after ${timeoutMs}ms waiting for session status "${until}"`,
      );
    }
    await sleep(intervalMs);
  }
}

export function useSessions(): UseSessionsReturn {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const data = await listSessions();
      if (mountedRef.current) {
        setSessions(data);
        setLoading(false);
      }
    } catch (e) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : "Failed to load sessions");
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

  return { sessions, loading, error, refresh, pollStatus };
}
