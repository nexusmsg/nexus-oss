import { useState } from "react";
import { useAuth } from "../app/auth-context";

export function AuthGate() {
  const { setBasicAuth } = useAuth();
  const [user, setUser] = useState("nexus");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pass) {
      setError("Password is required");
      return;
    }
    setError("");
    setBasicAuth(user, pass);
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "var(--bg)",
        fontFamily: "var(--font-body)",
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          padding: "32px",
          width: "100%",
          maxWidth: "380px",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: "var(--fg)",
              marginBottom: 4,
            }}
          >
            Nexus
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            Sign in to continue
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Username</label>
            <input
              className="form-input"
              type="text"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder="nexus"
              autoFocus
            />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              className="form-input"
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder="API token"
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
          <button
            className="btn btn-primary"
            type="submit"
            style={{ width: "100%", justifyContent: "center" }}
          >
            Sign In
          </button>
        </form>
      </div>
    </div>
  );
}
