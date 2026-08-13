"use client";

/* ── Revoke Key confirmation modal (UI-5) ──
 *
 * A danger-styled confirmation matching the Nexus alert/modal tokens: a
 * warning that revocation is permanent, the key name being revoked, and
 * Confirm/Cancel actions. Confirm calls `useApiKeys().revoke(serial)`, which
 * refreshes the list (the row drops out of the active view), then closes.
 */

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Modal, ModalActions } from "@/components";
import { IconWarning } from "@/components/icons";
import type { ApiKey } from "@/lib/api/types";

interface RevokeKeyModalProps {
  open: boolean;
  /** The key being revoked (supplies `serial` + `name` for the warning). */
  apiKey: ApiKey | null;
  /** Performs the revoke (`useApiKeys.revoke`); resolves after list refresh. */
  onRevoke: (serial: string) => Promise<unknown>;
  onClose: () => void;
}

export function RevokeKeyModal({
  open,
  apiKey,
  onRevoke,
  onClose,
}: RevokeKeyModalProps) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Guard against state updates after unmount (e.g. navigating away mid-request).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Reset transient state whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on open, not cascading
    setSubmitError(null);
    setLoading(false);
  }, [open]);

  const handleConfirm = async () => {
    if (!apiKey) return;
    setSubmitError(null);
    setLoading(true);
    try {
      await onRevoke(apiKey.serial);
      if (mountedRef.current) onClose();
    } catch (err) {
      // Keep the modal open with the error visible so the user can retry.
      if (mountedRef.current) {
        setSubmitError(
          err instanceof Error ? err.message : "Failed to revoke key",
        );
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Revoke Key">
      <Alert variant="warning" icon={<IconWarning size={16} />} className="mb-4">
        <span>
          Revoking <strong>&quot;{apiKey?.name}&quot;</strong> is permanent and
          can&apos;t be undone. Any integration using this key will immediately
          lose access.
        </span>
      </Alert>

      {/* Submission error — stays visible so the user can retry */}
      {submitError && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-danger/20 bg-danger/8 px-3 py-2 text-xs text-danger"
        >
          {submitError}
        </div>
      )}

      <ModalActions>
        <Button variant="ghost" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="danger"
          type="button"
          loading={loading}
          onClick={handleConfirm}
        >
          Revoke
        </Button>
      </ModalActions>
    </Modal>
  );
}
