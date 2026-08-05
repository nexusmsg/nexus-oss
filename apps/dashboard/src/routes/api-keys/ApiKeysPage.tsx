import { useState } from "react";
import { IconPlus, IconWarning } from "../../components/icons";

// ── API Keys Page ──
// Frontend-first: empty state, no backend yet (B1 in M2+)

export function ApiKeysPage() {
  const [generateOpen, setGenerateOpen] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">API Keys</div>
          <div className="page-subtitle">
            Manage authentication keys for your integrations
          </div>
        </div>
        <button
          className="btn btn-primary"
          disabled
          title="API keys backend coming soon"
        >
          <IconPlus />
          Generate Key
        </button>
      </div>

      <div className="alert alert-warning">
        <IconWarning />
        <span>
          <strong>API keys backend coming soon.</strong> The key management
          system is being built. For now, use the environment token or Basic
          Auth to access the API.
        </span>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">0 keys</div>
          <div style={{ display: "flex", gap: 8 }}>
            <select
              className="form-select"
              style={{ width: "auto", padding: "5px 10px", fontSize: 12 }}
              disabled
            >
              <option>All statuses</option>
            </select>
          </div>
        </div>
        <div className="empty-state">
          <div className="empty-icon">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
            </svg>
          </div>
          <div className="empty-title">No API keys yet</div>
          <div className="empty-desc">
            API key management is coming in a future release. For now, authenticate
            using the environment variable or Basic Auth.
          </div>
        </div>
      </div>

      {/* Generate Modal (disabled, informational) */}
      {generateOpen && (
        <div
          className="modal-overlay open"
          onClick={(e) => {
            if (e.target === e.currentTarget) setGenerateOpen(false);
          }}
        >
          <div className="modal">
            <div className="modal-header">
              <h3>Generate New Key</h3>
              <button
                className="modal-close"
                onClick={() => setGenerateOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="alert alert-warning" style={{ marginBottom: 16 }}>
              <IconWarning />
              <span>This feature requires the API keys backend (B1).</span>
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                onClick={() => setGenerateOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Revealed key modal (placeholder) */}
      {revealedKey && (
        <div
          className="modal-overlay open"
          onClick={(e) => {
            if (e.target === e.currentTarget) setRevealedKey(null);
          }}
        >
          <div className="modal">
            <div className="modal-header">
              <h3>Key Generated</h3>
              <button
                className="modal-close"
                onClick={() => setRevealedKey(null)}
              >
                ✕
              </button>
            </div>
            <div
              style={{
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                padding: "12px 16px",
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                wordBreak: "break-all",
                marginBottom: 16,
              }}
            >
              {revealedKey}
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                onClick={() => {
                  navigator.clipboard.writeText(revealedKey);
                }}
              >
                Copy to Clipboard
              </button>
              <button
                className="btn btn-primary"
                onClick={() => setRevealedKey(null)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
