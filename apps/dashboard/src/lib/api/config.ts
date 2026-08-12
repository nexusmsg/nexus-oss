/**
 * Environment configuration for the API service.
 *
 * All values are read from `process.env` (overridable for tests via the
 * optional `env` parameter). Required values are left empty when unset so the
 * composition root can fail fast with a clear message.
 */

export interface Config {
  /** Postgres connection string. */
  databaseUrl: string;
  /**
   * Bearer token required on `POST /:phone_number_id/messages`.
   * Empty string disables auth on that route.
   */
  apiAuthToken: string;
  /**
   * Bearer token required on `GET /internal/webhook-config`.
   * Empty string disables the internal route (it returns 401).
   */
  internalToken: string;
  /** Max wall-clock time (ms) to wait for a job to reach a terminal state. Default 25000. */
  sendTimeoutMs: number;
  /** Delay (ms) between job status polls while waiting for a terminal state. Default 250. */
  resultPollMs: number;
  /** TTL (ms) for heartbeat. Default 30000. */
  heartbeatTtlMs: number;
  /**
   * Max wall-clock time (ms) for a one-shot webhook test probe before the
   * endpoint is reported as timed out. Default 10000.
   */
  webhookTestTimeoutMs: number;
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    databaseUrl: env.DATABASE_URL ?? "",
    apiAuthToken: env.API_AUTH_TOKEN ?? "",
    internalToken: env.INTERNAL_TOKEN ?? "",
    sendTimeoutMs: readPositiveInt(env.SEND_TIMEOUT_MS, 25000),
    resultPollMs: readPositiveInt(env.RESULT_POLL_MS, 250),
    heartbeatTtlMs: readPositiveInt(env.HEARTBEAT_TTL_MS, 30000),
    webhookTestTimeoutMs: readPositiveInt(env.WEBHOOK_TEST_TIMEOUT_MS, 10000),
  };
}
