/* ── Typed fetch wrapper ──
 *
 * JSON (de)serialization, shared Authorization resolution (see ./auth),
 * WABA error-envelope normalization (`{ error: { message, type, code } }`).
 * Uses same-origin requests (empty base URL).
 */

import { resolveAuthHeader } from "./auth";
import { ApiError } from "./types";

/** Base URL for same-origin API calls (empty string = relative URL). */
export function getApiBaseUrl(): string {
  return "";
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const auth = resolveAuthHeader();
  if (auth !== null) headers.set("Authorization", auth);
  headers.set("Accept", "application/json");
  if (init?.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${getApiBaseUrl()}${path}`, { ...init, headers });

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

export function apiDelete(path: string): Promise<void> {
  return request<void>(path, { method: "DELETE" });
}
