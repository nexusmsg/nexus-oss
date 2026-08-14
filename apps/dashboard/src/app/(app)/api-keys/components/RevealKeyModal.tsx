"use client";

/* ── Key revealed modal ──
 *
 * Displays a plaintext API-key secret for copying. Supports two modes:
 *
 * - `generate` (default): shown once after key creation. Warning-tinted alert
 *   encourages the user to save the key immediately.
 * - `reveal`: shown when the user requests an existing key on demand.
 *   Informational alert reminds them to store it securely.
 *
 * Security contract:
 * - The plaintext secret has a single transient owner: the page's state, which
 *   is dropped when the reveal modal closes (any path) and gone on page
 *   unmount. This modal renders it from that prop and never copies it into a
 *   second location, so there is no window where a stale plaintext could
 *   outlive the close.
 * - The Copy action calls `navigator.clipboard.writeText` for real; feedback
 *   distinguishes a successful copy from a rejected/unavailable clipboard.
 */

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Modal, ModalActions } from "@/components";
import { IconCopy, IconInfo, IconWarning } from "@/components/icons";

type RevealKeyMode = "generate" | "reveal";

interface RevealKeyModalProps {
  open: boolean;
  /** Plaintext secret; null when nothing to show yet. */
  secret: string | null;
  /** Close handler; the parent is responsible for dropping its copy too. */
  onClose: () => void;
  /** "generate" = fresh creation; "reveal" = on-demand view of an existing key. */
  mode?: RevealKeyMode;
}

type CopyState = "idle" | "success" | "error";

const MODE_COPY: Record<
  RevealKeyMode,
  { title: string; alertVariant: "warning" | "info"; alertText: string }
> = {
  generate: {
    title: "Key Generated",
    alertVariant: "warning",
    alertText:
      "Save this key now. You can reveal it again from the key list.",
  },
  reveal: {
    title: "Reveal Key",
    alertVariant: "info",
    alertText: "Copy this key and store it securely.",
  },
};

export function RevealKeyModal({
  open,
  secret,
  onClose,
  mode = "generate",
}: RevealKeyModalProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleClose = () => {
    setCopyState("idle");
    onClose();
  };

  const handleCopy = async () => {
    if (secret === null) return;
    try {
      if (typeof navigator.clipboard?.writeText !== "function") {
        throw new Error("Clipboard unavailable");
      }
      await navigator.clipboard.writeText(secret);
      if (mountedRef.current) setCopyState("success");
    } catch {
      if (mountedRef.current) setCopyState("error");
    }
  };

  const { title, alertVariant, alertText } = MODE_COPY[mode];
  const AlertIcon = mode === "generate" ? IconWarning : IconInfo;

  return (
    <Modal open={open} onClose={handleClose} title={title}>
      <Alert
        variant={alertVariant}
        icon={<AlertIcon size={16} />}
        className="mb-4"
      >
        <span>{alertText}</span>
      </Alert>

      {/* The plaintext renders only while the modal is open (and prop is set). */}
      {open && secret !== null && (
        <div className="mb-4 break-all rounded-md border border-line bg-canvas px-4 py-3 font-mono text-sm text-fg">
          {secret}
        </div>
      )}

      {copyState === "success" && (
        <p
          role="status"
          className="mb-4 flex items-center gap-1.5 text-xs text-success"
        >
          <IconCopy size={12} /> Copied to clipboard.
        </p>
      )}
      {copyState === "error" && (
        <p role="alert" className="mb-4 text-xs text-danger">
          Couldn&apos;t copy automatically — select the key above and copy it
          manually.
        </p>
      )}

      <ModalActions>
        <Button variant="ghost" type="button" onClick={() => void handleCopy()}>
          <IconCopy size={13} /> Copy to Clipboard
        </Button>
        <Button type="button" onClick={handleClose}>
          Done
        </Button>
      </ModalActions>
    </Modal>
  );
}
