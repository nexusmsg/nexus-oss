/**
 * Driven adapter: fetch-based implementation of the WebhookForwarder port for
 * the one-shot webhook test. Owns the HTTP concerns:
 *
 * - bounded wall-clock timeout via an AbortController (combined with the
 *   caller's signal)
 * - `redirect: "manual"` — redirects are surfaced as their own 3xx response,
 *   never followed
 * - response body capped at `MAX_WEBHOOK_RESPONSE_BYTES`
 * - outcomes classified as response / timeout / network / aborted so the
 *   service layer never handles raw fetch errors
 */

import type {
  WebhookForwarder,
  WebhookForwardRequest,
  WebhookForwardResponse,
  WebhookForwardResult,
} from "../ports/webhook-forwarder";

/** Response-size cap: 64 KiB of body text is enough to verify an endpoint. */
export const MAX_WEBHOOK_RESPONSE_BYTES = 64 * 1024;

export class FetchWebhookForwarder implements WebhookForwarder {
  async post(request: WebhookForwardRequest): Promise<WebhookForwardResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    const onCallerAbort = (): void => controller.abort();
    request.signal?.addEventListener("abort", onCallerAbort, { once: true });

    try {
      let response: Response;
      try {
        response = await fetch(request.url, {
          method: "POST",
          headers: request.headers,
          body: request.body,
          redirect: "manual",
          signal: controller.signal,
        });
      } catch (err) {
        if (request.signal?.aborted) {
          return { kind: "aborted", message: "request aborted" };
        }
        if (controller.signal.aborted) {
          return { kind: "timeout" };
        }
        return { kind: "network", message: errorMessage(err) };
      }

      const { text, truncated } = await readCappedBody(
        response,
        MAX_WEBHOOK_RESPONSE_BYTES,
      );

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      const forwardResponse: WebhookForwardResponse = {
        status: response.status,
        statusText: response.statusText,
        headers,
        body: text === "" ? null : text,
        bodyTruncated: truncated,
      };
      return { kind: "response", response: forwardResponse };
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onCallerAbort);
    }
  }
}

/** Read up to `cap` bytes of a response body, reporting truncation. */
async function readCappedBody(
  response: Response,
  cap: number,
): Promise<{ text: string; truncated: boolean }> {
  if (response.body === null) {
    return { text: "", truncated: false };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      if (total + value.length > cap) {
        chunks.push(value.subarray(0, cap - total));
        total = cap;
        truncated = true;
        break;
      }
      chunks.push(value);
      total += value.length;
    }
  } finally {
    if (truncated) {
      await reader.cancel().catch(() => undefined);
    }
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return { text: new TextDecoder().decode(merged), truncated };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Compile-time assertion (Go convention): FetchWebhookForwarder implements WebhookForwarder. */
const _: WebhookForwarder = undefined as unknown as FetchWebhookForwarder;
