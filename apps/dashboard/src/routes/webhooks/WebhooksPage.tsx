import { useState, useEffect, useCallback } from "react";
import {
  listWebhooks,
  createWebhook,
  updateWebhook,
  deleteWebhook,
} from "../../api/webhooks";
import { listSessions } from "../../api/sessions";
import type { WebhookConfig } from "../../api/webhooks";
import type { Session } from "../../api/sessions";
import { IconPlus, IconPlay, IconEdit, IconTrash, IconJobs } from "../../components/icons";
import { TooltipButton } from "../../components/TooltipButton";

// ── Add/Edit Modal ──

function WebhookModal({
  open,
  onClose,
  sessions,
  editConfig,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  sessions: Session[];
  editConfig?: WebhookConfig | null;
  onSaved: () => void;
}) {
  const [phoneId, setPhoneId] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [maxRetries, setMaxRetries] = useState(3);
  const [retryDelay, setRetryDelay] = useState(1000);
  const [timeout, setTimeout_] = useState(5000);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (editConfig) {
      setPhoneId(editConfig.phone_number_id);
      setUrl(editConfig.webhook_url);
      setSecret(editConfig.webhook_secret || "");
      setEnabled(editConfig.enabled);
      setMaxRetries(editConfig.max_retries);
      setRetryDelay(editConfig.retry_delay_ms);
      setTimeout_(editConfig.timeout_ms);
    } else {
      setPhoneId("");
      setUrl("");
      setSecret("");
      setEnabled(true);
      setMaxRetries(3);
      setRetryDelay(1000);
      setTimeout_(5000);
    }
  }, [editConfig, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneId || !url) {
      setError("Phone and Webhook URL are required");
      return;
    }
    setError("");
    setLoading(true);
    try {
      if (editConfig) {
        // PATCH — all fields
        await updateWebhook(editConfig.serial, {
          webhook_url: url,
          webhook_secret: secret || undefined,
          enabled,
          max_retries: maxRetries,
          retry_delay_ms: retryDelay,
          timeout_ms: timeout,
        });
      } else {
        // POST — only phone_number_id, webhook_url, webhook_secret
        await createWebhook({
          phone_number_id: phoneId,
          webhook_url: url,
          webhook_secret: secret || undefined,
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save webhook");
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="modal-overlay open"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h3>{editConfig ? "Edit Webhook" : "Add Webhook"}</h3>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Phone Number</label>
            <select
              className="form-select"
              value={phoneId}
              onChange={(e) => setPhoneId(e.target.value)}
              disabled={!!editConfig}
            >
              <option value="">Select a phone number</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.phone_number_id}>
                  {s.number}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Webhook URL</label>
            <input
              className="form-input"
              type="url"
              placeholder="https://api.example.com/hooks/nexus"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <div className="form-hint">
              Must be HTTPS. Nexus will POST events to this URL.
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Secret (optional)</label>
            <input
              className="form-input"
              type="text"
              placeholder="Leave blank to skip signature verification"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
            <div className="form-hint">
              If set, Nexus signs each payload with HMAC-SHA256 using this secret.
            </div>
          </div>

          {editConfig && (
            <>
              <div className="form-group">
                <label className="form-label">Status</label>
                <select
                  className="form-select"
                  value={enabled ? "active" : "paused"}
                  onChange={(e) => setEnabled(e.target.value === "active")}
                >
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                </select>
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Max Retries</label>
                  <input
                    className="form-input"
                    type="number"
                    value={maxRetries}
                    onChange={(e) => setMaxRetries(Number(e.target.value))}
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Retry Delay (ms)</label>
                  <input
                    className="form-input"
                    type="number"
                    value={retryDelay}
                    onChange={(e) => setRetryDelay(Number(e.target.value))}
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Timeout (ms)</label>
                  <input
                    className="form-input"
                    type="number"
                    value={timeout}
                    onChange={(e) => setTimeout_(Number(e.target.value))}
                  />
                </div>
              </div>
            </>
          )}

          {error && (
            <div
              style={{ fontSize: 12, color: "var(--danger)", marginBottom: 12 }}
            >
              {error}
            </div>
          )}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
            >
              {loading ? "Saving..." : editConfig ? "Save Changes" : "Save Webhook"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Webhooks Page ──

export function WebhooksPage() {
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editConfig, setEditConfig] = useState<WebhookConfig | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [whRes, sessRes] = await Promise.all([
        listWebhooks(),
        listSessions(),
      ]);
      setWebhooks(whRes.webhooks);
      setSessions(sessRes.sessions);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load webhooks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDelete = async (serial: string) => {
    if (!confirm("Delete this webhook? This cannot be undone.")) return;
    try {
      await deleteWebhook(serial);
      await fetchData();
    } catch {
      // silently fail
    }
  };

  const handleEdit = (config: WebhookConfig) => {
    setEditConfig(config);
    setModalOpen(true);
  };

  const phoneLookup = (phoneId: string) => {
    const s = sessions.find((sess) => sess.phone_number_id === phoneId);
    return s?.number || phoneId;
  };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Webhooks</div>
          <div className="page-subtitle">
            Configure endpoints for inbound message forwarding
          </div>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => {
            setEditConfig(null);
            setModalOpen(true);
          }}
        >
          <IconPlus />
          Add Webhook
        </button>
      </div>

      {loading ? (
        <div className="empty-state">
          <div className="empty-icon"><IconJobs /></div>
          <div className="empty-title">Loading webhooks...</div>
        </div>
      ) : error ? (
        <div className="empty-state">
          <div className="empty-icon"><IconJobs /></div>
          <div className="empty-title">Failed to load webhooks</div>
          <div className="empty-desc">{error}</div>
          <button className="btn btn-ghost" onClick={fetchData}>Retry</button>
        </div>
      ) : (
        <>
          {/* Webhook Configs Table */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">
                <IconWebhookInline />
                Configured Webhooks
              </div>
            </div>
            {webhooks.length === 0 ? (
              <div className="empty-state" style={{ padding: "40px 24px" }}>
                <div className="empty-icon"><IconPlus /></div>
                <div className="empty-title">No webhooks configured</div>
                <div className="empty-desc">
                  Add a webhook to start receiving events from your WhatsApp devices.
                </div>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setEditConfig(null);
                    setModalOpen(true);
                  }}
                >
                  <IconPlus />
                  Add Webhook
                </button>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Phone Number</th>
                      <th>Webhook URL</th>
                      <th>Secret</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {webhooks.map((wh) => (
                      <tr key={wh.serial}>
                        <td className="mono">{phoneLookup(wh.phone_number_id)}</td>
                        <td
                          className="mono"
                          style={{
                            maxWidth: 280,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {wh.webhook_url}
                        </td>
                        <td>
                          <span
                            className={`badge ${wh.webhook_secret ? "success" : "neutral"}`}
                          >
                            {wh.webhook_secret ? "set" : "empty"}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${wh.enabled ? "success" : "warning"}`}>
                            <span className="badge-dot" />{" "}
                            {wh.enabled ? "active" : "paused"}
                          </span>
                        </td>
                        <td>
                          <div className="actions">
                            <TooltipButton
                              className="btn-icon"
                              disabled
                              tooltip="Requires backend B6"
                            >
                              <IconPlay />
                            </TooltipButton>
                            <button
                              className="btn-icon"
                              title="Edit"
                              onClick={() => handleEdit(wh)}
                            >
                              <IconEdit />
                            </button>
                            <button
                              className="btn-icon"
                              title="Delete"
                              style={{
                                borderColor: "var(--danger)",
                                color: "var(--danger)",
                              }}
                              onClick={() => handleDelete(wh.serial)}
                            >
                              <IconTrash />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Delivery Log (empty state) */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">
                <IconJobs />
                Delivery Log
              </div>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                Last 10 deliveries
              </span>
            </div>
            <div className="empty-state" style={{ padding: "40px 24px" }}>
              <div className="empty-icon"><IconJobs /></div>
              <div className="empty-title">No delivery data yet</div>
              <div className="empty-desc">
                Delivery logs will appear here once your webhooks start receiving events.
              </div>
            </div>
          </div>
        </>
      )}

      <WebhookModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditConfig(null);
        }}
        sessions={sessions}
        editConfig={editConfig}
        onSaved={fetchData}
      />
    </>
  );
}

// Inline webhook icon for the card title
function IconWebhookInline() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
