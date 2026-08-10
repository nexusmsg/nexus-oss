"use client";

/* ── QR pairing polling hook ──
 *
 * Flow (per the sessions milestone plan):
 *   `start(serial)` / `refresh()` → POST /sessions/:serial/pairing → poll
 *   GET .../pairing/qr every 3s until `ready` (render QR), `expired` (hard
 *   timeout / the worker marked it expired), or an error. `cancel()` stops
 *   polling; the loop is torn down on unmount via an AbortController.
 *
 * The worker only ever stores the FIRST QR per pairing job, so `refresh()`
 * always re-issues the pairing POST and resets the poll from scratch.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getPairingQr, requestPairing } from "@/lib/api/sessions";
import type { PairingQr } from "@/lib/api/types";

export type QrPhase = "generating" | "ready" | "expired" | "error";

export interface UsePairingQrOptions {
  /** Poll interval between GET pairing/qr calls. Default 3000ms. */
  intervalMs?: number;
  /** Hard ceiling before flipping to `expired`. Default 5min (QR TTL). */
  timeoutMs?: number;
}

export interface UsePairingQrReturn {
  phase: QrPhase;
  qrCode: string | null;
  /** Human-readable message for the `error` phase. */
  error: string | null;
  /** Issue a new pairing job for `serial` and start/restart the poll. */
  start: (serial: string) => Promise<void>;
  /** Re-issue pairing for the current serial and reset the poll. */
  refresh: () => Promise<void>;
  /** Stop polling and reset to `generating`. */
  cancel: () => void;
}

export const QR_POLL_INTERVAL_MS = 3_000;
export const QR_POLL_TIMEOUT_MS = 5 * 60 * 1000; // worker QR TTL

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function usePairingQr(options: UsePairingQrOptions = {}): UsePairingQrReturn {
  const intervalMs = options.intervalMs ?? QR_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? QR_POLL_TIMEOUT_MS;
  const [phase, setPhase] = useState<QrPhase>("generating");
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const activeRef = useRef(false);
  const serialRef = useRef<string | null>(null);

  /** Abort any in-flight poll loop. */
  const stop = useCallback(() => {
    activeRef.current = false;
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  /** Tear down the loop on unmount. */
  useEffect(() => () => stop(), [stop]);

  const runPoll = useCallback(
    async (serial: string) => {
      stop();
      const controller = new AbortController();
      controllerRef.current = controller;
      activeRef.current = true;
      const deadline = Date.now() + timeoutMs;

      try {
        await requestPairing(serial);
      } catch (err) {
        if (activeRef.current) {
          setPhase("error");
          setError(err instanceof Error ? err.message : "Failed to start pairing");
        }
        return;
      }

      while (activeRef.current) {
        if (controller.signal.aborted) return;

        let qr: PairingQr;
        try {
          qr = await getPairingQr(serial, { signal: controller.signal });
        } catch (err) {
          if (!activeRef.current) return;
          setPhase("error");
          setError(err instanceof Error ? err.message : "Failed to load pairing QR");
          return;
        }

        if (qr.status === "ready" && qr.qr_code !== null) {
          setQrCode(qr.qr_code);
          setPhase("ready");
          return;
        }
        if (qr.status === "expired" || Date.now() >= deadline) {
          setPhase("expired");
          return;
        }
        // pending / not_found → no QR yet, keep polling.
        try {
          await sleep(intervalMs, controller.signal);
        } catch {
          return; // aborted / cancelled
        }
      }
    },
    [intervalMs, timeoutMs, stop],
  );

  const start = useCallback(
    async (serial: string) => {
      serialRef.current = serial;
      setPhase("generating");
      setQrCode(null);
      setError(null);
      await runPoll(serial);
    },
    [runPoll],
  );

  const refresh = useCallback(
    async () => {
      const serial = serialRef.current;
      if (!serial) return;
      setPhase("generating");
      setQrCode(null);
      setError(null);
      await runPoll(serial);
    },
    [runPoll],
  );

  const cancel = useCallback(() => {
    stop();
    serialRef.current = null;
    setQrCode(null);
    setError(null);
    setPhase("generating");
  }, [stop]);

  return { phase, qrCode, error, start, refresh, cancel };
}
