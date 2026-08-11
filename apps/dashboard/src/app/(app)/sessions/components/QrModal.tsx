"use client";

import { useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Modal, ModalActions, Button, Alert } from "@/components";
import { usePairingQr } from "@/lib/hooks/usePairingQr";
import { IconWarning } from "@/components/icons";

interface QrModalProps {
  open: boolean;
  onClose: () => void;
  serial: string | null;
}

export function QrModal({ open, onClose, serial }: QrModalProps) {
  const { phase, qrCode, start, refresh, cancel } = usePairingQr();

  // Auto-start polling when modal opens with a serial
  useEffect(() => {
    if (open && serial) {
      start(serial);
    }
  }, [open, serial, start]);

  const handleClose = () => {
    cancel();
    onClose();
  };

  const handleRefresh = () => {
    refresh();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={
        phase === "ready"
          ? "Scan QR Code"
          : phase === "expired"
            ? "QR Expired"
            : "Pairing Device"
      }
    >
      <div className="flex flex-col items-center gap-4">
        {/* QR Display */}
        <div className="flex h-[192px] w-[192px] items-center justify-center rounded-lg bg-white p-6">
          {phase === "generating" && (
            <div className="flex flex-col items-center gap-2">
              <span
                className="h-8 w-8 rounded-full border-2 border-accent/30 border-t-accent"
                style={{ animation: "nexus-spin 0.6s linear infinite" }}
              />
              <span className="text-xs text-gray-500">Generating…</span>
            </div>
          )}
          {phase === "ready" && qrCode && (
            <QRCodeSVG value={qrCode} size={144} />
          )}
          {phase === "expired" && (
            <div className="flex flex-col items-center gap-2 text-center">
              <IconWarning size={32} className="text-gray-400" />
              <span className="text-xs text-gray-500">QR expired</span>
            </div>
          )}
          {phase === "error" && (
            <div className="flex flex-col items-center gap-2 text-center">
              <IconWarning size={32} className="text-danger" />
              <span className="text-xs text-danger">Failed to load QR</span>
            </div>
          )}
        </div>

        {/* Instructions */}
        {phase === "ready" && (
          <p className="text-center text-xs text-muted leading-relaxed">
            Open WhatsApp → Settings → Linked Devices → Link a Device
            <br />
            Point your phone camera at this QR code
          </p>
        )}

        {phase === "expired" && (
          <Alert variant="warning" icon={<IconWarning size={16} />}>
            QR code has expired. Click &quot;Refresh QR&quot; to generate a new
            one.
          </Alert>
        )}

        {phase === "error" && (
          <Alert variant="warning" icon={<IconWarning size={16} />}>
            Something went wrong. Please try refreshing or close and
            reopen.
          </Alert>
        )}
      </div>

      <ModalActions>
        <Button variant="ghost" onClick={handleClose}>
          Cancel
        </Button>
        {(phase === "expired" || phase === "error") && (
          <Button onClick={handleRefresh}>Refresh QR</Button>
        )}
      </ModalActions>
    </Modal>
  );
}
