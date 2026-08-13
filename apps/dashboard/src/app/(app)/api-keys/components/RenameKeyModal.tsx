"use client";

/* ── Rename Key modal (UI-5) ──
 *
 * Matches the inline-edit pattern of GenerateKeyModal: a single key-name input
 * pre-filled with the current name, client-side validation mirroring the
 * domain cap (required, ≤ 200 chars), a loading submit state, and in-modal API
 * error handling.
 *
 * On success it calls `useApiKeys().update(serial, { name })`, which refreshes
 * the list, then closes. The plaintext secret is never involved here.
 */

import { useEffect, useRef, useState } from "react";
import {
  Button,
  FormGroup,
  FormHint,
  FormInput,
  FormLabel,
  Modal,
  ModalActions,
} from "@/components";
import type { ApiKey, UpdateApiKeyInput } from "@/lib/api/types";

interface RenameKeyModalProps {
  open: boolean;
  /** The key being renamed (supplies `serial` + current `name`). */
  apiKey: ApiKey | null;
  /** Performs the rename (`useApiKeys.update`); resolves after list refresh. */
  onRename: (serial: string, input: UpdateApiKeyInput) => Promise<unknown>;
  onClose: () => void;
}

/** Client-side mirror of the domain cap in api-key-management.ts. */
const MAX_NAME_LENGTH = 200;

export function RenameKeyModal({
  open,
  apiKey,
  onRename,
  onClose,
}: RenameKeyModalProps) {
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
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

  // Reset the form and pre-fill with the current name whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- form reset on open, not cascading
    setName(apiKey?.name ?? "");
    setNameError(null);
    setSubmitError(null);
    setLoading(false);
  }, [open, apiKey]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmed = name.trim();
    if (trimmed === "") {
      setNameError("Name is required");
      return;
    }
    if (trimmed.length > MAX_NAME_LENGTH) {
      setNameError(`Name must be at most ${MAX_NAME_LENGTH} characters`);
      return;
    }
    if (!apiKey) return;

    setNameError(null);
    setSubmitError(null);
    setLoading(true);
    try {
      await onRename(apiKey.serial, { name: trimmed });
      if (mountedRef.current) onClose();
    } catch (err) {
      // Keep the modal open with the error visible so the user can retry.
      if (mountedRef.current) {
        setSubmitError(
          err instanceof Error ? err.message : "Failed to rename key",
        );
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Rename Key">
      <form onSubmit={handleSubmit} noValidate>
        <FormGroup className="mb-0">
          <FormLabel htmlFor="rename-key-name">Key Name</FormLabel>
          <FormInput
            id="rename-key-name"
            type="text"
            placeholder="e.g. Production, Staging, CI/CD"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            maxLength={MAX_NAME_LENGTH}
            error={nameError !== null}
          />
          {nameError ? (
            <FormHint error>{nameError}</FormHint>
          ) : (
            <FormHint>Give the key a name you can recognize later.</FormHint>
          )}
        </FormGroup>

        {/* Submission error — stays visible so the user can retry */}
        {submitError && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-danger/20 bg-danger/8 px-3 py-2 text-xs text-danger"
          >
            {submitError}
          </div>
        )}

        <ModalActions>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            Save
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}
