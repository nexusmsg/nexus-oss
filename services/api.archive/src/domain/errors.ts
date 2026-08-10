/**
 * Application errors. Pure domain: no Hono / Supabase / node imports.
 * The HTTP adapter maps these to WABA envelopes; the service layer throws
 * them during the send flow.
 */

/** Raised when a WABA message body fails validation. Message is user-facing. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Raised when a job does not reach a terminal state before the deadline. */
export class SendTimeoutError extends Error {
  constructor() {
    super("send timed out");
    this.name = "SendTimeoutError";
  }
}

/**
 * Raised when the request's AbortSignal fires while the service waits for a
 * job. Kept distinct from `SendTimeoutError` so the HTTP adapter can rethrow
 * it (the client is gone) instead of mapping it to a response.
 */
export class RequestAbortedError extends Error {
  constructor() {
    super("request aborted");
    this.name = "AbortError";
  }
}
