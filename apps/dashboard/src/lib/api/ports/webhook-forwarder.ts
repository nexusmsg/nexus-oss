/**
 * Driven port: outbound HTTP delivery for the one-shot webhook test. The
 * fetch-based adapter implements it; TestWebhookService depends on it.
 *
 * The forwarder owns HTTP concerns (timeout, redirects, response-size cap)
 * and classifies every outcome so the service never has to catch transport
 * errors from the port.
 */

export interface WebhookForwardRequest {
  url: string;
  /** Raw JSON body bytes (the exact bytes the signature was computed over). */
  body: string;
  headers: Record<string, string>;
  /** Per-request wall-clock budget (ms). */
  timeoutMs: number;
  /** Caller signal; when it fires the attempt is reported as `aborted`. */
  signal?: AbortSignal;
}

export interface WebhookForwardResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  /** Response body capped at the adapter's limit; null when empty. */
  body: string | null;
  bodyTruncated: boolean;
}

export type WebhookForwardResult =
  | { kind: "response"; response: WebhookForwardResponse }
  | { kind: "timeout" }
  | { kind: "network"; message: string }
  | { kind: "aborted"; message: string };

export interface WebhookForwarder {
  post(request: WebhookForwardRequest): Promise<WebhookForwardResult>;
}
