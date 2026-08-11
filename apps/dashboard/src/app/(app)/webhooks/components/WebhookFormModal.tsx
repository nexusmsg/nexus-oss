"use client";

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
import { IconEye, IconEyeOff } from "@/components/icons";
import type {
  CreateWebhookInput,
  Session,
  UpdateWebhookInput,
  WebhookConfig,
} from "@/lib/api/types";

interface WebhookFormModalProps {
  open: boolean;
  onClose: () => void;
  /** When provided, the modal operates in edit mode. */
  webhook?: WebhookConfig | null;
  sessions: Session[];
  sessionsLoading: boolean;
  /** Phone number IDs that already have a webhook config (excluded in create mode). */
  configuredPhoneNumberIds?: string[];
  onSubmit: (input: CreateWebhookInput | UpdateWebhookInput) => Promise<void>;
}

/** Valid http(s) URL — mirrors the domain rule for `webhook_url`. */
function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Cryptographically random `whsec_`-prefixed secret for the Generate button. */
function generateSecret(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return "whsec_" + Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export function WebhookFormModal({
  open,
  onClose,
  webhook,
  sessions,
  sessionsLoading,
  configuredPhoneNumberIds = [],
  onSubmit,
}: WebhookFormModalProps) {
  const isEdit = webhook !== null && webhook !== undefined;

  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
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

  // Reset the form whenever the modal opens / the target webhook changes.
  useEffect(() => {
    if (!open) return;
    if (isEdit && webhook) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- form reset on open, not cascading
      setPhoneNumberId(webhook.phone_number_id);
      setWebhookUrl(webhook.webhook_url);
      setSecret(webhook.webhook_secret ?? "");
    } else {
      setPhoneNumberId("");
      setWebhookUrl("");
      setSecret("");
    }
    setShowSecret(false);
    setPhoneError(null);
    setUrlError(null);
    setError(null);
  }, [open, isEdit, webhook]);

  const availableSessions = sessions.filter(
    (s) => !configuredPhoneNumberIds.includes(s.phone_number_id),
  );
  const noPhonesAvailable = !sessionsLoading && availableSessions.length === 0;
  const selectedSession = sessions.find((s) => s.phone_number_id === phoneNumberId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedUrl = webhookUrl.trim();

    if (!isEdit && !phoneNumberId) {
      setPhoneError("Select a phone number");
      return;
    }
    if (trimmedUrl === "" || !isValidHttpUrl(trimmedUrl)) {
      setUrlError("Enter a valid http(s) URL");
      return;
    }

    setPhoneError(null);
    setUrlError(null);
    setError(null);

    // Edit with no changes — nothing to persist.
    if (isEdit && webhook) {
      const urlChanged = trimmedUrl !== webhook.webhook_url;
      const secretChanged = secret !== (webhook.webhook_secret ?? "");
      if (!urlChanged && !secretChanged) {
        onClose();
        return;
      }
    }

    setLoading(true);
    try {
      if (isEdit && webhook) {
        const input: UpdateWebhookInput = {};
        if (trimmedUrl !== webhook.webhook_url) input.webhook_url = trimmedUrl;
        if (secret !== (webhook.webhook_secret ?? "")) {
          // Empty string disables payload signing; omitted keeps the current secret.
          input.webhook_secret = secret.trim();
        }
        await onSubmit(input);
      } else {
        await onSubmit({
          phone_number_id: phoneNumberId,
          webhook_url: trimmedUrl,
          webhook_secret: secret.trim(),
        });
      }
      if (mountedRef.current) onClose();
    } catch (err) {
      // Keep the modal open with the error visible so the user can retry.
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "Edit Webhook" : "Add Webhook"}>
      <form onSubmit={handleSubmit} noValidate>
        {/* Phone selector — only for create */}
        {!isEdit && (
          <FormGroup>
            <FormLabel htmlFor="wh-phone">Phone Number</FormLabel>
            <FormSelect
              id="wh-phone"
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
              required
              disabled={sessionsLoading}
              error={phoneError !== null}
            >
              <option value="">
                {sessionsLoading
                  ? "Loading phones..."
                  : noPhonesAvailable
                    ? "No available phone numbers"
                    : "Select a phone number"}
              </option>
              {availableSessions.map((s) => (
                <option key={s.phone_number_id} value={s.phone_number_id}>
                  {s.number || s.display_phone || s.phone_number_id}
                  {s.display_phone && s.number ? ` (${s.display_phone})` : ""}
                </option>
              ))}
            </FormSelect>
            {phoneError ? (
              <FormHint error>{phoneError}</FormHint>
            ) : noPhonesAvailable ? (
              <FormHint>Every phone number already has a webhook configured.</FormHint>
            ) : (
              selectedSession && (
                <FormHint>Device status: {selectedSession.status}</FormHint>
              )
            )}
          </FormGroup>
        )}

        {/* Read-only phone in edit mode */}
        {isEdit && selectedSession && (
          <FormGroup>
            <FormLabel>Phone Number</FormLabel>
            <div className="rounded-md border border-line bg-elevated px-3 py-2 font-mono text-sm text-fg">
              {selectedSession.number ||
                selectedSession.display_phone ||
                selectedSession.phone_number_id}
            </div>
          </FormGroup>
        )}

        {/* Webhook URL */}
        <FormGroup>
          <FormLabel htmlFor="wh-url">Webhook URL</FormLabel>
          <FormInput
            id="wh-url"
            type="url"
            placeholder="https://api.example.com/hooks/nexus"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            required={!isEdit}
            error={urlError !== null}
          />
          {urlError ? (
            <FormHint error>{urlError}</FormHint>
          ) : (
            <FormHint>
              {isEdit
                ? "The endpoint Nexus will POST events to."
                : "Must be HTTPS. Nexus will POST events to this URL."}
            </FormHint>
          )}
        </FormGroup>

        {/* Secret */}
        <FormGroup>
          <FormLabel htmlFor="wh-secret">
            {isEdit ? "Secret" : "Secret (optional)"}
          </FormLabel>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <FormInput
                id="wh-secret"
                type={showSecret ? "text" : "password"}
                placeholder={isEdit ? "" : "Leave blank to skip signature verification"}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setShowSecret((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted transition-colors hover:text-fg"
                aria-label={showSecret ? "Hide secret" : "Show secret"}
              >
                {showSecret ? <IconEyeOff size={14} /> : <IconEye size={14} />}
              </button>
            </div>
            {!isEdit && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSecret(generateSecret());
                  setShowSecret(true);
                }}
              >
                Generate
              </Button>
            )}
          </div>
          <FormHint>
            {isEdit
              ? "Plaintext secret used for HMAC-SHA256 payload signing. Leave blank to keep the current secret."
              : "If set, Nexus signs each payload with HMAC-SHA256 using this secret."}
          </FormHint>
        </FormGroup>

        {/* Submission error — stays visible so the user can retry */}
        {error && (
          <div className="mb-4 rounded-md border border-danger/20 bg-danger/8 px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}

        <ModalActions>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={loading} disabled={noPhonesAvailable}>
            {isEdit ? "Save Changes" : "Save Webhook"}
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}
