"use client";

/* ── Key revealed modal (UI-4) ──
 *
 * One-time reveal for a freshly generated key. Matches the "Key Generated"
 * modal in design/dashboard/api-keys.html: a warning that the key won't be
 * shown again, the plaintext secret, a real Copy to Clipboard action with
 * success/failure feedback, and a Done button.
 *
 * Security contract:
 * - The plaintext secret has a single transient owner: the page's
 *   `CreateApiKeyResult` state, which is dropped when the reveal modal closes
 *   (any path) and gone on page unmount. This modal renders it from that prop
 *   and never copies it into a second location, so there is no window where a
 *   stale plaintext could outlive the close.
 * - Existing-row keys never reach this modal (UI-3 keeps those Reveal/Copy
 *   actions disabled).
 * - The Copy action calls `navigator.clipboard.writeText` for real; feedback
 *   distinguishes a successful copy from a rejected/unavailable clipboard.
 */

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Modal, ModalActions } from "@/components";
import { IconCopy, IconWarning } from "@/components/icons";

interface RevealKeyModalProps {
  open: boolean;
  /** One-time plaintext secret; null when nothing was generated yet. */
  secret: string | null;
  /** Close handler; the parent is responsible for dropping its copy too. */
  onClose: () => void;
}

type CopyState = "idle" | "success" | "error";

export function RevealKeyModal({ open, secret, onClose }: RevealKeyModalProps) {
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

  return (
    <Modal open={open} onClose={handleClose} title="Key Generated">
      <Alert variant="warning" icon={<IconWarning size={16} />} className="mb-4">
        <span>Copy this key now. It won&apos;t be shown again.</span>
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
