/**
 * One-shot webhook test domain types. Pure domain: no node / HTTP imports.
 *
 * The probe builds a deterministic synthetic inbound WABA `messages` payload,
 * POSTs it to the configured webhook URL (with an HMAC signature when a
 * secret is set), and reports a structured result for both HTTP responses and
 * transport failures.
 */

/** Deterministic synthetic inbound WABA `messages` webhook payload. */
export interface SyntheticWebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        contacts: Array<{
          profile: { name: string };
          wa_id: string;
        }>;
        messages: Array<{
          from: string;
          id: string;
          timestamp: string;
          type: string;
          text: { body: string };
        }>;
      };
      field: string;
    }>;
  }>;
}

/**
 * Failure codes for probe attempts that never produced an HTTP response
 * (or whose target was rejected before any request was made).
 */
export type WebhookProbeErrorCode =
  | "blocked_target" // SSRF guard rejected a private/loopback/link-local/metadata address
  | "dns_failed" // target hostname did not resolve
  | "timeout" // endpoint did not respond within the bounded timeout
  | "network"; // connection / transport error

export interface WebhookProbeError {
  code: WebhookProbeErrorCode;
  message: string;
}

/**
 * Structured result of a single one-shot webhook probe. `outcome` is
 * `"responded"` when the endpoint returned any HTTP status (including 3xx/4xx/5xx
 * or a redirect that was not followed); `"failed"` covers target rejection,
 * DNS failure, timeout, and network errors.
 */
export interface WebhookProbeResult {
  outcome: "responded" | "failed";
  /** `true` when the endpoint returned a 2xx status. */
  ok: boolean;
  /** HTTP status; null when the probe failed before/without a response. */
  status: number | null;
  statusText: string;
  headers: Record<string, string>;
  /** Response body, capped at the adapter's response-size limit. */
  body: string | null;
  /** `true` when the response body was truncated by the size cap. */
  bodyTruncated: boolean;
  durationMs: number;
  /** `true` when an X-Hub-Signature-256 header was attached to the request. */
  signatureSent: boolean;
  error: WebhookProbeError | null;
  /** Echo of the exact synthetic payload that was sent. */
  payload: SyntheticWebhookPayload;
}
