"use client";

/* ── Generate Key modal (UI-4) ──
 *
 * Matches the "Generate New Key" modal in design/dashboard/api-keys.html:
 * key-name input, scope select (full/write/read), expiry select (90/180/365
 * days or no expiry), client-side validation, a loading submit state, and
 * in-modal API error handling.
 *
 * On success it hands the one-time `CreateApiKeyResult` (which contains the
 * plaintext secret) to the page via `onCreated` and closes itself so the page
 * can open the reveal modal. The plaintext itself is never held here — it goes
 * straight to the reveal modal's transient state.
 */

import { useEffect, useRef, useState } from "react";
import {
  Button,
  FormGroup,
  FormHint,
  FormInput,
  FormLabel,
  FormSelect,
  Modal,
  ModalActions,
} from "@/components";
import type {
  ApiKeyScope,
  CreateApiKeyInput,
  CreateApiKeyResult,
} from "@/lib/api/types";

interface GenerateKeyModalProps {
  open: boolean;
  onClose: () => void;
  /** Performs the create (`useApiKeys.create`); resolves to the one-time result. */
  onCreate: (input: CreateApiKeyInput) => Promise<CreateApiKeyResult>;
  /** Called with the one-time result so the page can show the reveal modal. */
  onCreated: (result: CreateApiKeyResult) => void;
}

/** Client-side mirror of the domain cap in api-key-management.ts. */
const MAX_NAME_LENGTH = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

const SCOPE_OPTIONS: { value: ApiKeyScope; label: string }[] = [
  { value: "full", label: "Full — read + write + admin" },
  { value: "write", label: "Write — send messages, manage webhooks" },
  { value: "read", label: "Read — view only, no mutations" },
];

const EXPIRY_OPTIONS: { value: string; label: string }[] = [
  { value: "90", label: "90 days" },
  { value: "180", label: "180 days" },
  { value: "365", label: "1 year" },
  { value: "0", label: "No expiry" },
];

export function GenerateKeyModal({
  open,
  onClose,
  onCreate,
  onCreated,
}: GenerateKeyModalProps) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState<ApiKeyScope>("full");
  const [expiryDays, setExpiryDays] = useState("90");
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

  // Reset the form whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- form reset on open, not cascading
    setName("");
    setScope("full");
    setExpiryDays("90");
    setNameError(null);
    setSubmitError(null);
    setLoading(false);
  }, [open]);

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

    setNameError(null);
    setSubmitError(null);
    setLoading(true);
    try {
      const input: CreateApiKeyInput = { name: trimmed, scope };
      if (expiryDays === "0") {
        input.expires_at = null;
      } else {
        input.expires_at = new Date(
          Date.now() + Number(expiryDays) * DAY_MS,
        ).toISOString();
      }

      const result = await onCreate(input);
      if (mountedRef.current) {
        // Hand off the one-time plaintext, then close the form so the page can
        // open the reveal modal (matches the design's generateKey() flow).
        onCreated(result);
        onClose();
      }
    } catch (err) {
      // Keep the modal open with the error visible so the user can retry.
      if (mountedRef.current) {
        setSubmitError(
          err instanceof Error ? err.message : "Failed to create API key",
        );
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Generate New Key">
      <form onSubmit={handleSubmit} noValidate>
        <FormGroup>
          <FormLabel htmlFor="api-key-name">Key Name</FormLabel>
          <FormInput
            id="api-key-name"
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

        <FormGroup>
          <FormLabel htmlFor="api-key-scope">Scope</FormLabel>
          <FormSelect
            id="api-key-scope"
            value={scope}
            onChange={(e) => setScope(e.target.value as ApiKeyScope)}
          >
            {SCOPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </FormSelect>
          <FormHint>
            Read-only keys cannot send messages or modify configuration.
          </FormHint>
        </FormGroup>

        <FormGroup className="mb-0">
          <FormLabel htmlFor="api-key-expiry">Expiry</FormLabel>
          <FormSelect
            id="api-key-expiry"
            value={expiryDays}
            onChange={(e) => setExpiryDays(e.target.value)}
          >
            {EXPIRY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </FormSelect>
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
            Generate
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}
