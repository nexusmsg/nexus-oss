"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Modal, ModalActions, Button, Alert } from "@/components";
import { usePairingQr } from "@/lib/hooks/usePairingQr";
import { pollStatus } from "@/lib/hooks/useSessions";
import { IconWarning } from "@/components/icons";

interface QrModalProps {
  open: boolean;
  onClose: () => void;
  serial: string | null;
  /** Called when the session transitions to `connected` after a successful scan. */
  onConnected?: () => void;
}

type ConnectionPhase = "idle" | "waiting" | "connecting" | "connected" | "failed";

/** Status-poll timeout (how long we wait for the session to become `connected`). */
const STATUS_POLL_TIMEOUT_MS = 60_000;
/** Grace period after QR is displayed before we start polling status. */
const SCAN_GRACE_MS = 2_000;
/** Delay before auto-closing after a successful connection. */
const AUTO_CLOSE_DELAY_MS = 2_000;

export function QrModal({ open, onClose, serial, onConnected }: QrModalProps) {
  const { phase, qrCode, start, refresh, cancel } = usePairingQr();

  /* ── Connection-tracking state ── */
  const [connectionPhase, setConnectionPhase] = useState<ConnectionPhase>("idle");
  const mountedRef = useRef(true);
  const pollingRef = useRef<AbortController | null>(null);
  const autoCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Mounted guard ── */
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /* ── Auto-start pairing when the modal opens with a serial ── */
  useEffect(() => {
    if (open && serial) {
      start(serial);
    }
  }, [open, serial, start]);

  /* ── Cleanup helpers ── */
  const stopPolling = useCallback(() => {
    pollingRef.current?.abort();
    pollingRef.current = null;
  }, []);

  const clearAutoClose = useCallback(() => {
    if (autoCloseRef.current) {
      clearTimeout(autoCloseRef.current);
      autoCloseRef.current = null;
    }
  }, []);

  /* ── Cleanup on unmount ── */
  useEffect(() => () => {
    stopPolling();
    clearAutoClose();
  }, [stopPolling, clearAutoClose]);

  /* ── Status polling effect ── */
  useEffect(() => {
    // Only start polling when QR is ready and we have a serial
    if (phase !== "ready" || !serial) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    pollingRef.current = controller;

    const run = async () => {
      // Brief grace period so the user can orient before we start checking
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, SCAN_GRACE_MS);
        controller.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
      if (cancelled || controller.signal.aborted) return;

      if (mountedRef.current) {
        setConnectionPhase("waiting");
      }

      try {
        await pollStatus(serial, "connected", STATUS_POLL_TIMEOUT_MS, controller.signal);
        if (!cancelled && mountedRef.current) {
          setConnectionPhase("connected");
          onConnected?.();
          // Auto-close after a brief success display
          autoCloseRef.current = setTimeout(() => {
            if (mountedRef.current) {
              cancel();
              onClose();
            }
          }, AUTO_CLOSE_DELAY_MS);
        }
      } catch {
        if (!cancelled && mountedRef.current) {
          setConnectionPhase("failed");
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [phase, serial, onConnected, cancel, onClose]);

  /* ── Reset connection phase when QR phase leaves `ready` ── */
  useEffect(() => {
    if (phase !== "ready") {
      // Reset state when QR lifecycle changes (leaves `ready`)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConnectionPhase("idle");
      stopPolling();
      clearAutoClose();
    }
  }, [phase, stopPolling, clearAutoClose]);

  /* ── Reset everything when modal closes ── */
  useEffect(() => {
    if (!open) {
      // Reset state when modal lifecycle changes (closes)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConnectionPhase("idle");
      stopPolling();
      clearAutoClose();
    }
  }, [open, stopPolling, clearAutoClose]);

  /* ── Handlers ── */
  const handleClose = useCallback(() => {
    stopPolling();
    clearAutoClose();
    cancel();
    onClose();
  }, [stopPolling, clearAutoClose, cancel, onClose]);

  const handleRefresh = useCallback(() => {
    setConnectionPhase("idle");
    stopPolling();
    clearAutoClose();
    refresh();
  }, [stopPolling, clearAutoClose, refresh]);

  /* ── Derived title ── */
  const title =
    connectionPhase === "connected"
      ? "Connected!"
      : connectionPhase === "waiting" || connectionPhase === "connecting"
        ? "Waiting for Scan…"
        : phase === "ready"
          ? "Scan QR Code"
          : phase === "expired"
            ? "QR Expired"
            : "Pairing Device";

  return (
    <Modal open={open} onClose={handleClose} title={title}>
      <div className="flex flex-col items-center gap-4">
        {/* QR Display */}
        <div className="flex h-[192px] w-[192px] items-center justify-center rounded-lg bg-white p-6">
          {/* Generating spinner */}
          {phase === "generating" && (
            <div className="flex flex-col items-center gap-2">
              <span
                className="h-8 w-8 rounded-full border-2 border-accent/30 border-t-accent"
                style={{ animation: "nexus-spin 0.6s linear infinite" }}
              />
              <span className="text-xs text-gray-500">Generating…</span>
            </div>
          )}

          {/* QR code */}
          {phase === "ready" && qrCode && connectionPhase !== "connected" && (
            <QRCodeSVG value={qrCode} size={144} />
          )}

          {/* Success overlay — shown after scan completes */}
          {connectionPhase === "connected" && (
            <div className="flex flex-col items-center gap-2">
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-success"
              >
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <span className="text-xs font-medium text-success">
                Device connected
              </span>
            </div>
          )}

          {/* Waiting-for-scan spinner */}
          {(connectionPhase === "waiting" || connectionPhase === "connecting") &&
            phase === "ready" &&
            qrCode && (
              <div className="flex flex-col items-center gap-2">
                <QRCodeSVG value={qrCode} size={144} className="opacity-60" />
              </div>
            )}

          {/* Expired */}
          {phase === "expired" && (
            <div className="flex flex-col items-center gap-2 text-center">
              <IconWarning size={32} className="text-gray-400" />
              <span className="text-xs text-gray-500">QR expired</span>
            </div>
          )}

          {/* Error */}
          {phase === "error" && (
            <div className="flex flex-col items-center gap-2 text-center">
              <IconWarning size={32} className="text-danger" />
              <span className="text-xs text-danger">Failed to load QR</span>
            </div>
          )}
        </div>

        {/* Instructions — visible while QR is displayed and not yet connected */}
        {phase === "ready" && connectionPhase !== "connected" && (
          <p className="text-center text-xs text-muted leading-relaxed">
            Open WhatsApp → Settings → Linked Devices → Link a Device
            <br />
            Point your phone camera at this QR code
          </p>
        )}

        {/* Waiting for scan feedback */}
        {connectionPhase === "waiting" && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <span
              className="h-3 w-3 rounded-full border-2 border-accent/30 border-t-accent"
              style={{ animation: "nexus-spin 0.6s linear infinite" }}
            />
            Waiting for scan confirmation…
          </div>
        )}

        {/* Success message */}
        {connectionPhase === "connected" && (
          <p className="text-center text-xs text-success leading-relaxed">
            Device successfully linked. This window will close automatically.
          </p>
        )}

        {/* Expired alert */}
        {phase === "expired" && (
          <Alert variant="warning" icon={<IconWarning size={16} />}>
            QR code has expired. Click &quot;Refresh QR&quot; to generate a new
            one.
          </Alert>
        )}

        {/* Error alert */}
        {phase === "error" && (
          <Alert variant="warning" icon={<IconWarning size={16} />}>
            Something went wrong. Please try refreshing or close and reopen.
          </Alert>
        )}

        {/* Connection failed alert */}
        {connectionPhase === "failed" && (
          <Alert variant="warning" icon={<IconWarning size={16} />}>
            Could not confirm connection. The QR may have expired or the device
            went offline. Try refreshing.
          </Alert>
        )}
      </div>

      <ModalActions>
        <Button variant="ghost" onClick={handleClose}>
          {connectionPhase === "connected" ? "Done" : "Cancel"}
        </Button>
        {(phase === "expired" || phase === "error" || connectionPhase === "failed") && (
          <Button onClick={handleRefresh}>Refresh QR</Button>
        )}
      </ModalActions>
    </Modal>
  );
}
