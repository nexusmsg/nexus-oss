import { useState, useEffect, useCallback } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  listSessions,
  createSession,
  startPairing,
  getPairingQr,
  logoutSession,
} from "../../api/sessions";
import type { Session, QrResponse } from "../../api/sessions";
import {
  IconPlus,
  IconInfo,
  IconCalendar,
  IconUser,
  IconFile,
  IconError,
} from "../../components/icons";
import { TooltipButton } from "../../components/TooltipButton";

// ── Status mapping ──

function statusBadge(status: Session["status"]) {
  switch (status) {
    case "connected":
      return <span className="badge success"><span className="badge-dot" /> connected</span>;
    case "pairing":
      return <span className="badge warning"><span className="badge-dot" /> pairing</span>;
    case "disconnected":
    case "logged_out":
      return <span className="badge danger"><span className="badge-dot" /> {status}</span>;
    case "created":
      return <span className="badge neutral"><span className="badge-dot" /> created</span>;
    default:
      return <span className="badge neutral">{status}</span>;
  }
}

function statusDot(status: Session["status"]) {
  switch (status) {
    case "connected":
      return "connected";
    case "pairing":
      return "pairing";
    case "disconnected":
    case "logged_out":
      return "disconnected";
    default:
      return "disconnected";
  }
}

function formatLastSeen(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function isError(status: Session["status"]) {
  return status === "disconnected" || status === "logged_out";
}

// ── Device Card ──

function DeviceCard({
  session,
  onShowQr,
  onLogout,
}: {
  session: Session;
  onShowQr: (serial: string) => void;
  onLogout: (serial: string) => void;
}) {
  const borderColor =
    session.status === "pairing"
      ? "rgba(251,191,36,.3)"
      : isError(session.status)
        ? "rgba(248,113,113,.3)"
        : undefined;

  return (
    <div className="device-card" style={borderColor ? { borderColor } : undefined}>
      <div className="device-card-header">
        <div>
          <div className="device-phone">{session.number}</div>
          <div className="device-name">
            {session.business_account_id || "—"}
          </div>
        </div>
        <div className="device-status">
          <div className={`status-dot ${statusDot(session.status)}`} />
          {statusBadge(session.status)}
        </div>
      </div>

      {isError(session.status) && (
        <div className="device-error">
          <IconError />
          <span>
            Connection lost — device is disconnected. Reconnect to restore it.
          </span>
        </div>
      )}

      <div className="device-meta">
        <div className="device-meta-row">
          <IconCalendar />
          <span className="label">Last seen</span>
          <span className="value">
            {session.status === "pairing"
              ? "Pairing pending"
              : formatLastSeen(session.last_seen_at)}
          </span>
        </div>
        <div className="device-meta-row">
          <IconUser />
          <span className="label">Number</span>
          <span className="value">{session.number}</span>
        </div>
        <div className="device-meta-row">
          <IconFile />
          <span className="label">Account ID</span>
          <span className="value">{session.business_account_id || "—"}</span>
        </div>
      </div>

      <div className="device-actions">
        {session.status === "connected" && (
          <>
            <TooltipButton
              className="btn btn-ghost btn-sm"
              disabled
              tooltip="Requires backend B2"
            >
              Disconnect
            </TooltipButton>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => onLogout(session.id)}
            >
              Logout
            </button>
            <TooltipButton
              className="btn btn-danger btn-sm"
              disabled
              tooltip="Requires backend B2"
            >
              Delete
            </TooltipButton>
          </>
        )}
        {session.status === "pairing" && (
          <>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => onShowQr(session.id)}
            >
              Show QR
            </button>
            <TooltipButton
              className="btn btn-danger btn-sm"
              disabled
              tooltip="Requires backend B2"
            >
              Cancel
            </TooltipButton>
          </>
        )}
        {(session.status === "disconnected" ||
          session.status === "logged_out") && (
          <>
            <button
              className="btn btn-primary btn-sm"
              style={{ flex: 1 }}
              onClick={() => onShowQr(session.id)}
            >
              Reconnect
            </button>
            <TooltipButton
              className="btn btn-danger btn-sm"
              disabled
              tooltip="Requires backend B2"
            >
              Delete
            </TooltipButton>
          </>
        )}
        {session.status === "created" && (
          <button
            className="btn btn-primary btn-sm"
            style={{ flex: 1 }}
            onClick={() => onShowQr(session.id)}
          >
            Start Pairing
          </button>
        )}
      </div>
    </div>
  );
}

// ── Add Device Modal ──

function AddDeviceModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [number, setNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // QR state
  const [pairingSerial, setPairingSerial] = useState<string | null>(null);
  const [qrData, setQrData] = useState<QrResponse | null>(null);
  const [polling, setPolling] = useState(false);

  const reset = () => {
    setPhoneNumberId("");
    setNumber("");
    setError("");
    setPairingSerial(null);
    setQrData(null);
    setPolling(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  // Poll QR status
  useEffect(() => {
    if (!pairingSerial || !polling) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await getPairingQr(pairingSerial);
        if (cancelled) return;
        setQrData(res);
        if (res.status === "ready" || res.status === "pending") {
          setTimeout(poll, 2000);
        }
      } catch {
        if (!cancelled) setPolling(false);
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [pairingSerial, polling]);

  const handleStartPairing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneNumberId || !number) {
      setError("Phone Number ID and Number are required");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const session = await createSession({
        phone_number_id: phoneNumberId,
        number,
      });
      await startPairing(session.id);
      setPairingSerial(session.id);
      setPolling(true);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className={`modal-overlay${open ? " open" : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="modal">
        <div className="modal-header">
          <h3>Add New Device</h3>
          <button className="modal-close" onClick={handleClose}>
            ✕
          </button>
        </div>

        {!pairingSerial ? (
          <form onSubmit={handleStartPairing}>
            <div className="form-group">
              <label className="form-label">Phone Number ID</label>
              <input
                className="form-input"
                type="text"
                placeholder="Meta-assigned phone number ID"
                value={phoneNumberId}
                onChange={(e) => setPhoneNumberId(e.target.value)}
              />
              <div className="form-hint">
                The unique identifier for this phone number from Meta.
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Phone Number</label>
              <input
                className="form-input"
                type="tel"
                placeholder="+62 8xx-xxxx-xxxx"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
              />
            </div>
            {error && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--danger)",
                  marginBottom: 12,
                }}
              >
                {error}
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={handleClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
              >
                {loading ? "Creating..." : "Start Pairing"}
              </button>
            </div>
          </form>
        ) : (
          <>
            <div style={{ textAlign: "center", margin: "20px 0" }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  marginBottom: 12,
                }}
              >
                Scan QR Code with WhatsApp
              </div>
              <div className="qr-container">
                {qrData?.status === "ready" && qrData.qr_code ? (
                  <QRCodeSVG value={qrData.qr_code} size={192} />
                ) : qrData?.status === "expired" || qrData?.status === "not_found" ? (
                  <div style={{ padding: 24, textAlign: "center" }}>
                    <IconError />
                    <div style={{ fontSize: 13, color: "#333", marginTop: 8 }}>
                      QR expired. Click retry.
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      width: 192,
                      height: 192,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 13,
                      color: "#666",
                    }}
                  >
                    Waiting for QR...
                  </div>
                )}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--muted)",
                  marginTop: 12,
                  lineHeight: 1.6,
                }}
              >
                Open WhatsApp → Settings → Linked Devices → Link a Device
                <br />
                Point your phone camera at this QR code
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={handleClose}>
                Close
              </button>
              {(qrData?.status === "expired" || qrData?.status === "not_found") && (
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setQrData(null);
                    setPolling(true);
                  }}
                >
                  Retry
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Sessions Page ──

export function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [qrModalSerial, setQrModalSerial] = useState<string | null>(null);
  const [qrData, setQrData] = useState<QrResponse | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await listSessions();
      setSessions(res.sessions);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sessions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Status polling — refresh every 10s
  useEffect(() => {
    const interval = setInterval(fetchSessions, 10000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  const handleLogout = async (serial: string) => {
    try {
      await logoutSession(serial);
      await fetchSessions();
    } catch {
      // silently fail — no toast system in M1
    }
  };

  // QR modal polling
  useEffect(() => {
    if (!qrModalSerial) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await getPairingQr(qrModalSerial);
        if (cancelled) return;
        setQrData(res);
        if (res.status === "ready" || res.status === "pending") {
          setTimeout(poll, 2000);
        }
      } catch {
        // ignore
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [qrModalSerial]);

  const openQrModal = (serial: string) => {
    setQrModalSerial(serial);
    setQrData(null);
  };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Sessions</div>
          <div className="page-subtitle">
            Manage WhatsApp devices connected to your account
          </div>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setModalOpen(true)}
        >
          <IconPlus />
          Add Device
        </button>
      </div>

      <div className="alert alert-info">
        <IconInfo />
        <span>
          Each device requires a separate WhatsApp Business account. Scan the QR
          code with WhatsApp on the target phone.
        </span>
      </div>

      {loading ? (
        <div className="empty-state">
          <div className="empty-icon">
            <IconInfo />
          </div>
          <div className="empty-title">Loading sessions...</div>
        </div>
      ) : error ? (
        <div className="empty-state">
          <div className="empty-icon">
            <IconError />
          </div>
          <div className="empty-title">Failed to load sessions</div>
          <div className="empty-desc">{error}</div>
          <button className="btn btn-ghost" onClick={fetchSessions}>
            Retry
          </button>
        </div>
      ) : sessions.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">
            <IconPlus />
          </div>
          <div className="empty-title">No devices yet</div>
          <div className="empty-desc">
            Add your first WhatsApp device to start sending and receiving messages.
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setModalOpen(true)}
          >
            <IconPlus />
            Add Device
          </button>
        </div>
      ) : (
        <div className="device-grid">
          {sessions.map((s) => (
            <DeviceCard
              key={s.id}
              session={s}
              onShowQr={openQrModal}
              onLogout={handleLogout}
            />
          ))}
        </div>
      )}

      <AddDeviceModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={fetchSessions}
      />

      {/* QR modal for existing devices */}
      {qrModalSerial && (
        <div
          className="modal-overlay open"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setQrModalSerial(null);
              setQrData(null);
            }
          }}
        >
          <div className="modal">
            <div className="modal-header">
              <h3>QR Code</h3>
              <button
                className="modal-close"
                onClick={() => {
                  setQrModalSerial(null);
                  setQrData(null);
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ textAlign: "center", margin: "20px 0" }}>
              <div className="qr-container">
                {qrData?.status === "ready" && qrData.qr_code ? (
                  <QRCodeSVG value={qrData.qr_code} size={192} />
                ) : (
                  <div
                    style={{
                      width: 192,
                      height: 192,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 13,
                      color: "#666",
                    }}
                  >
                    Waiting for QR...
                  </div>
                )}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--muted)",
                  marginTop: 12,
                  lineHeight: 1.6,
                }}
              >
                Open WhatsApp → Settings → Linked Devices → Link a Device
                <br />
                Point your phone camera at this QR code
              </div>
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setQrModalSerial(null);
                  setQrData(null);
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
