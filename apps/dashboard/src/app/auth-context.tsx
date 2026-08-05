import { createContext, useContext, useState, useCallback } from "react";
import type { ReactNode } from "react";

const SESSION_STORAGE_KEY = "nexus_basic_auth";

interface AuthState {
  /** The resolved Authorization header value, or null if not yet resolved. */
  authorization: string | null;
  /** Whether the auth gate should be shown. */
  showGate: boolean;
  /** Set Basic Auth credentials and cache them in sessionStorage. */
  setBasicAuth: (user: string, pass: string) => void;
  /** Clear stored credentials and show the gate. */
  clearAuth: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authorization, setAuthorization] = useState<string | null>(() => {
    // Synchronous initial check to avoid flash of wrong content
    const envToken = import.meta.env.VITE_API_TOKEN;
    if (envToken && envToken.length > 0) {
      return `Bearer ${envToken}`;
    }
    const cached = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (cached) {
      return `Basic ${cached}`;
    }
    return null;
  });
  const [showGate, setShowGate] = useState(() => {
    // Synchronous initial check
    const envToken = import.meta.env.VITE_API_TOKEN;
    if (envToken && envToken.length > 0) return false;
    const cached = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (cached) return false;
    return true;
  });

  const setBasicAuth = useCallback((user: string, pass: string) => {
    const encoded = btoa(`${user}:${pass}`);
    sessionStorage.setItem(SESSION_STORAGE_KEY, encoded);
    setAuthorization(`Basic ${encoded}`);
    setShowGate(false);
  }, []);

  const clearAuth = useCallback(() => {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    setAuthorization(null);
    setShowGate(true);
  }, []);

  return (
    <AuthContext.Provider value={{ authorization, showGate, setBasicAuth, clearAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
