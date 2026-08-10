"use client";

import { useState, useCallback } from "react";
import {
  Button,
  Alert,
  EmptyState,
  Modal,
  ModalActions,
} from "@/components";
import { IconPlus, IconPhone, IconInfo } from "@/components/icons";
import { useSessions } from "@/lib/hooks/useSessions";
import { logout } from "@/lib/api/sessions";
import { DeviceCard } from "./components/DeviceCard";
import { AddDeviceModal } from "./components/AddDeviceModal";
import { QrModal } from "./components/QrModal";

export default function SessionsPage() {
  const { sessions, loading, error, refresh, pollStatus } = useSessions();

  // Modal states
  const [addOpen, setAddOpen] = useState(false);
  const [qrSerial, setQrSerial] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [logoutSerial, setLogoutSerial] = useState<string | null>(null);
  const [logoutLoading, setLogoutLoading] = useState(false);

  /* ── QR flows ── */

  const handleShowQr = useCallback((serial: string) => {
    setQrSerial(serial);
    setQrOpen(true);
  }, []);

  const handleStartPairing = useCallback(
    (serial: string) => {
      // Trigger pairing then show QR
      handleShowQr(serial);
    },
    [handleShowQr],
  );

  const handleReconnect = useCallback(
    (serial: string) => {
      handleShowQr(serial);
    },
    [handleShowQr],
  );

  /* ── Logout flow ── */

  const handleLogoutRequest = useCallback((serial: string) => {
    setLogoutSerial(serial);
  }, []);

  const handleLogoutConfirm = useCallback(async () => {
    if (!logoutSerial) return;
    setLogoutLoading(true);
    try {
      await logout(logoutSerial);
      await pollStatus(logoutSerial, "logged_out", 15_000);
      await refresh();
    } catch {
      // best-effort — poll will catch it
    } finally {
      setLogoutLoading(false);
      setLogoutSerial(null);
    }
  }, [logoutSerial, pollStatus, refresh]);

  const handleCreated = useCallback(() => {
    refresh();
  }, [refresh]);

  return (
    <>
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Sessions</h1>
          <p className="mt-1 text-sm text-muted">
            Manage WhatsApp devices connected to your account
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <IconPlus size={14} /> Add Device
        </Button>
      </div>

      {/* Info alert */}
      <Alert variant="info" icon={<IconInfo size={16} />}>
        Each device requires a separate WhatsApp Business account. Scan the QR
        code with WhatsApp on the target phone.
      </Alert>

      {/* Error banner */}
      {error && (
        <div className="rounded-md bg-danger/8 border border-danger/20 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && sessions.length === 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[repeat(auto-fill,minmax(340px,1fr))]">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-64 animate-pulse rounded-lg bg-surface border border-line"
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && sessions.length === 0 && !error && (
        <EmptyState
          icon={<IconPhone size={28} />}
          title="No devices paired"
          description="Connect a WhatsApp Business account to start sending and receiving messages."
          action={
            <Button onClick={() => setAddOpen(true)}>
              <IconPlus size={14} /> Add Device
            </Button>
          }
        />
      )}

      {/* Device grid */}
      {sessions.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[repeat(auto-fill,minmax(340px,1fr))]">
          {sessions.map((s) => (
            <DeviceCard
              key={s.id}
              session={s}
              onShowQr={handleShowQr}
              onStartPairing={handleStartPairing}
              onReconnect={handleReconnect}
              onLogout={handleLogoutRequest}
            />
          ))}
        </div>
      )}

      {/* Add Device Modal */}
      <AddDeviceModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={handleCreated}
        onShowQr={handleShowQr}
      />

      {/* QR Modal */}
      <QrModal open={qrOpen} onClose={() => setQrOpen(false)} serial={qrSerial} />

      {/* Logout Confirm Dialog */}
      <Modal
        open={!!logoutSerial}
        onClose={() => setLogoutSerial(null)}
        title="Logout Device"
      >
        <p className="text-sm text-muted mb-2">
          Are you sure you want to log out this device? It will be disconnected
          from WhatsApp until you pair it again.
        </p>
        <ModalActions>
          <Button variant="ghost" onClick={() => setLogoutSerial(null)}>
            Cancel
          </Button>
          <Button variant="danger" loading={logoutLoading} onClick={handleLogoutConfirm}>
            Logout
          </Button>
        </ModalActions>
      </Modal>
    </>
  );
}
