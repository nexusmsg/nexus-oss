/**
 * Environment configuration for the API service.
 *
 * All values are read from `process.env` (overridable for tests via the
 * optional `env` parameter). Required values are left empty when unset so the
 * composition root (`src/index.ts`) can fail fast with a clear message.
 */

export interface Config {
  /** HTTP listen port. Default 3000. */
  port: number;
  /** Supabase project URL (PostgREST endpoint). */
  supabaseUrl: string;
  /** Supabase service-role key. Matches docker-compose / .env.example. */
  supabaseServiceRoleKey: string;
  /**
   * Bearer token required on `POST /:phone_number_id/messages`.
   * Empty string disables auth on that route.
   */
  apiAuthToken: string;
  /**
   * Bearer token required on `GET /internal/webhook-config`.
   * Empty string disables the internal route (it returns 401 and a warning is
   * logged at app creation time).
   */
  internalToken: string;
  /** Max wall-clock time (ms) to wait for a job to reach a terminal state. Default 25000. */
  sendTimeoutMs: number;
  /** Delay (ms) between job status polls while waiting for a terminal state. Default 250. */
  resultPollMs: number;
  /**
   * Allow-list of origins permitted to call `/api/v1/*` cross-origin (CORS).
   * Parsed from the comma-separated `CORS_ORIGINS` env var. Defaults to
   * `["http://localhost:5173"]` (the Vite dev origin); an empty array disables
   * CORS entirely.
   */
  corsOrigins: string[];
}

const DEFAULT_CORS_ORIGIN = "http://localhost:5173";

function parseCorsOrigins(value: string | undefined): string[] {
  if (value === undefined) {
    return [DEFAULT_CORS_ORIGIN];
  }
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin !== "");
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: readPositiveInt(env.PORT, 3000),
    supabaseUrl: env.SUPABASE_URL ?? "",
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    apiAuthToken: env.API_AUTH_TOKEN ?? "",
    internalToken: env.INTERNAL_TOKEN ?? "",
    sendTimeoutMs: readPositiveInt(env.SEND_TIMEOUT_MS, 25000),
    resultPollMs: readPositiveInt(env.RESULT_POLL_MS, 250),
    corsOrigins: parseCorsOrigins(env.CORS_ORIGINS),
  };
}
