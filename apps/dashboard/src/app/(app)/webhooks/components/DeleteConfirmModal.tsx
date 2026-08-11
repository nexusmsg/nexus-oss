"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Modal, ModalActions } from "@/components";
import type { WebhookConfig } from "@/lib/api/types";

interface DeleteConfirmModalProps {
  open: boolean;
  onClose: () => void;
  webhook: WebhookConfig | null;
  onDelete: (serial: string) => Promise<void>;
}

export function DeleteConfirmModal({
  open,
  onClose,
  webhook,
  onDelete,
}: DeleteConfirmModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guard against state updates after unmount (e.g. navigating away mid-request).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Clear any previous failure each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on open
    setError(null);
  }, [open]);

  const handleConfirm = async () => {
    if (!webhook) return;
    setLoading(true);
    setError(null);
    try {
      await onDelete(webhook.serial);
      if (mountedRef.current) onClose();
    } catch (e) {
      // Keep the dialog open with the error visible so the user can retry.
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : "Failed to delete webhook");
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Delete Webhook">
      <p className="mb-1 text-sm text-muted">
        Are you sure you want to delete this webhook?
      </p>
      {webhook && (
        <p className="mb-4 truncate font-mono text-sm text-fg">
          {webhook.webhook_url}
        </p>
      )}
      <p className="text-sm text-muted">
        Events will stop being forwarded to this endpoint immediately. This action
        cannot be undone.
      </p>

      {error && (
        <div className="mt-4 rounded-md border border-danger/20 bg-danger/8 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      <ModalActions>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" loading={loading} onClick={handleConfirm}>
          Delete
        </Button>
      </ModalActions>
    </Modal>
  );
}
