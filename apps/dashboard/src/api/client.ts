const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: { error: { code: number; details: string } },
  ) {
    super(body.error.details || `API error ${status}`);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const authHeader = resolveAuthHeader();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(authHeader ? { Authorization: authHeader } : {}),
    ...((init?.headers as Record<string, string>) || {}),
  };

  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers,
  });

  if (!res.ok) {
    let body: { error: { code: number; details: string } };
    try {
      body = await res.json();
    } catch {
      body = { error: { code: res.status, details: res.statusText } };
    }

    if (res.status === 401) {
      clearStoredAuth();
    }

    throw new ApiError(res.status, body);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json();
}

/**
 * Resolve Authorization header from env token or sessionStorage.
 * Standalone function (not a hook) so it works inside apiFetch.
 */
function resolveAuthHeader(): string | null {
  const envToken = import.meta.env.VITE_API_TOKEN;
  if (envToken && envToken.length > 0) {
    return `Bearer ${envToken}`;
  }
  const cached = sessionStorage.getItem("nexus_basic_auth");
  if (cached) {
    return `Basic ${cached}`;
  }
  return null;
}

function clearStoredAuth(): void {
  sessionStorage.removeItem("nexus_basic_auth");
  window.location.reload();
}
