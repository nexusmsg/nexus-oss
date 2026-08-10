/* ── Auth resolution ──
 *
 * Authorization strategy (per the sessions milestone plan):
 *   1. `NEXT_PUBLIC_API_TOKEN` set  → always send `Authorization: Bearer <token>`.
 *   2. Otherwise, on a 401          → prompt for the API auth token value and send
 *      `Authorization: Basic base64(<user>:<token>)`, cached in sessionStorage.
 *   3. No token / cancelled prompt  → no header. The API disables auth entirely
 *      when `API_AUTH_TOKEN` is empty, so unauthenticated requests still work.
 */

const SESSION_KEY = "nexus_auth_header";
const BASIC_USERNAME = "nexus"; // free-form username; the password carries the token

/** `NEXT_PUBLIC_API_TOKEN` → Bearer mode; blank/unset → Basic mode. */
export function getBearerToken(): string | undefined {
  const token = process.env.NEXT_PUBLIC_API_TOKEN;
  return typeof token === "string" && token.trim() !== "" ? token.trim() : undefined;
}

/** Build `Authorization: Basic base64(<user>:<password>)`. */
export function basicAuthHeader(password: string, username: string = BASIC_USERNAME): string {
  return `Basic ${btoa(`${username}:${password}`)}`;
}

/** Cache an Authorization header for the rest of the browser session. */
export function cacheAuthHeader(header: string): void {
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(SESSION_KEY, header);
  }
}

/** The cached Authorization header, or null. */
export function getCachedAuthHeader(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(SESSION_KEY);
}

export function clearAuthHeader(): void {
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(SESSION_KEY);
  }
}

/**
 * Resolves the Authorization header value for a request.
 *
 * Priority:
 * 1. `NEXT_PUBLIC_API_TOKEN` env → `Bearer <token>`
 * 2. SessionStorage cached value (from a Basic prompt on 401)
 * 3. null — no credentials (server may have auth disabled)
 */
export function resolveAuthHeader(): string | null {
  const token = getBearerToken();
  if (token !== undefined) return `Bearer ${token}`;
  return getCachedAuthHeader();
}

/**
 * Prompt for the API auth token (the value of the server's `API_AUTH_TOKEN`),
 * cache a Basic header, and return it. Returns null when the user cancels or
 * leaves the field empty.
 */
export function promptForBasicAuth(): string | null {
  if (typeof window === "undefined") return null;
  const password = window.prompt("Enter the API auth token (API_AUTH_TOKEN):");
  // jsdom's unimplemented prompt returns undefined; real browsers return null
  // when the user cancels.
  if (password === null || password === undefined) return null;
  const trimmed = password.trim();
  if (trimmed === "") return null;
  const header = basicAuthHeader(trimmed);
  cacheAuthHeader(header);
  return header;
}
