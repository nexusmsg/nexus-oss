/* ── Typed fetch wrapper ──
 *
 * Base URL from `NEXT_PUBLIC_API_URL`, JSON (de)serialization, shared
 * Authorization resolution (see ./auth), WABA error-envelope normalization
 * (`{ error: { message, type, code } }`), and the one-shot 401 → Basic prompt
 * retry when no bearer token is configured.
 */

import { getBearerToken, promptForBasicAuth, resolveAuthHeader } from "./auth";
import { ApiError } from "./types";

const DEFAULT_API_BASE_URL = "http://localhost:3000";

/** Base URL from `NEXT_PUBLIC_API_URL`, normalized to no trailing slash. */
export function getApiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
}

/** Shape of the WABA error envelope body. */
interface WabaErrorBody {
  error?: { message?: unknown; type?: unknown; code?: unknown; details?: unknown };
}

/**
 * Normalize a failed response into an `ApiError`, mapping the WABA envelope
 * `{ error: { message, type, code } }` (and the `{ code, details }` variant)
 * when present, otherwise falling back to `fallback`.
 */
export function normalizeApiError(status: number, body: unknown, fallback: string): ApiError {
  const envelope = (typeof body === "object" && body !== null ? body : null) as
    | WabaErrorBody
    | null;
  const err = envelope?.error;
  if (err !== undefined && err !== null && typeof err === "object") {
    const code = typeof err.code === "number" ? err.code : null;
    const details = typeof err.details === "string" ? err.details : null;
    const message =
      typeof err.message === "string" && err.message !== ""
        ? err.message
        : details ?? fallback;
    return new ApiError(status, message, code, details);
  }
  return new ApiError(status, fallback);
}

/** Parse a response body; null for empty / non-JSON payloads. */
async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function request<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
  const headers = new Headers(init?.headers);
  const auth = resolveAuthHeader();
  if (auth !== null) headers.set("Authorization", auth);
  headers.set("Accept", "application/json");
  if (init?.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${getApiBaseUrl()}${path}`, { ...init, headers });

  // One-shot Basic prompt: only when no bearer token is configured.
  if (res.status === 401 && !retried && getBearerToken() === undefined) {
    const header = promptForBasicAuth();
    if (header !== null) return request<T>(path, init, true);
  }

  if (!res.ok) {
    throw normalizeApiError(
      res.status,
      await readBody(res),
      res.statusText || `Request failed with status ${res.status}`,
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  return request<T>(path, { ...init, method: "GET" });
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
