"use client";

import { useState } from "react";
import { Modal, ModalActions, FormGroup, FormLabel, FormInput, Button } from "@/components";
import { createSession, requestPairing } from "@/lib/api/sessions";
import type { Session } from "@/lib/api/types";

interface AddDeviceModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (session: Session) => void;
  onShowQr: (serial: string) => void;
}

export function AddDeviceModal({
  open,
  onClose,
  onCreated,
  onShowQr,
}: AddDeviceModalProps) {
  const [number, setNumber] = useState("");
  const [phone_number_id, setPhoneNumberId] = useState("");
  const [display_phone, setDisplayPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!number.trim() || !phone_number_id.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const session = await createSession({
        number: number.trim(),
        phone_number_id: phone_number_id.trim(),
        display_phone: display_phone.trim() || undefined,
      });
      onCreated(session);
      // Auto-advance: request pairing and show QR
      try {
        await requestPairing(session.id);
      } catch {
        // pairing might fail — let user retry from card
      }
      onShowQr(session.id);
      // Reset form
      setNumber("");
      setPhoneNumberId("");
      setDisplayPhone("");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create session");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add New Device">
      <form onSubmit={handleSubmit}>
        <FormGroup>
          <FormLabel htmlFor="device-number">Phone Number</FormLabel>
          <FormInput
            id="device-number"
            type="tel"
            placeholder="+62 8xx-xxxx-xxxx"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            required
            autoFocus
          />
        </FormGroup>
        <FormGroup>
          <FormLabel htmlFor="device-pn-id">Phone Number ID</FormLabel>
          <FormInput
            id="device-pn-id"
            placeholder="e.g. 1234567890"
            value={phone_number_id}
            onChange={(e) => setPhoneNumberId(e.target.value)}
            required
          />
        </FormGroup>
        <FormGroup>
          <FormLabel htmlFor="device-label">Device Label (optional)</FormLabel>
          <FormInput
            id="device-label"
            placeholder="e.g. Production, Staging"
            value={display_phone}
            onChange={(e) => setDisplayPhone(e.target.value)}
          />
        </FormGroup>

        {error && (
          <div className="mb-4 rounded-md bg-danger/8 border border-danger/20 px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}

        <ModalActions>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            Create &amp; Pair
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}
