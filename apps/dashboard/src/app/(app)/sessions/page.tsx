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
import { deleteSession, logout } from "@/lib/api/sessions";
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
  const [deleteSerial, setDeleteSerial] = useState<string | null>(null);
  const [deleteMode, setDeleteMode] = useState<"delete" | "cancel">("delete");
  const [deleteLoading, setDeleteLoading] = useState(false);

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

  const requestDelete = useCallback((serial: string, mode: "delete" | "cancel") => {
    setDeleteSerial(serial);
    setDeleteMode(mode);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteSerial) return;
    setDeleteLoading(true);
    try {
      const session = sessions.find((item) => item.id === deleteSerial);
      if (deleteMode === "delete" && session?.status === "connected") {
        await logout(deleteSerial);
        await pollStatus(deleteSerial, "logged_out", 15_000);
      }
      await deleteSession(deleteSerial);
      setDeleteSerial(null);
      await refresh();
    } catch {
      // Keep the dialog open so the user can retry after a transient failure.
    } finally {
      setDeleteLoading(false);
    }
  }, [deleteMode, deleteSerial, pollStatus, refresh, sessions]);

  const handleQrConnected = useCallback(() => {
    refresh();
  }, [refresh]);

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
            <div key={i} className="flex h-[242px] flex-col gap-3.5 rounded-lg border border-line bg-surface p-5">
              <div className="h-5 w-2/3 animate-pulse rounded bg-elevated" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-elevated" />
              <div className="mt-2 space-y-2">
                <div className="h-3 w-4/5 animate-pulse rounded bg-elevated" />
                <div className="h-3 w-3/4 animate-pulse rounded bg-elevated" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-elevated" />
              </div>
              <div className="mt-auto h-8 animate-pulse rounded bg-elevated" />
            </div>
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
              onDelete={(serial) => requestDelete(serial, "delete")}
              onCancel={(serial) => requestDelete(serial, "cancel")}
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
      <QrModal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        serial={qrSerial}
        onConnected={handleQrConnected}
      />

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

      <Modal
        open={!!deleteSerial}
        onClose={() => setDeleteSerial(null)}
        title={deleteMode === "cancel" ? "Cancel Pairing" : "Delete Device"}
      >
        <p className="mb-2 text-sm text-muted">
          {deleteMode === "cancel"
            ? "Cancel pairing and remove this pending device?"
            : "Delete this device? Connected devices will be logged out first."}
        </p>
        <ModalActions>
          <Button variant="ghost" onClick={() => setDeleteSerial(null)}>Keep Device</Button>
          <Button variant="danger" loading={deleteLoading} onClick={handleDeleteConfirm}>
            {deleteMode === "cancel" ? "Cancel Pairing" : "Delete"}
          </Button>
        </ModalActions>
      </Modal>
    </>
  );
}
