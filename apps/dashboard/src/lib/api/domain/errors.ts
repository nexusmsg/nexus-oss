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

/**
 * Raised when an API-key record has no recoverable ciphertext (e.g. a
 * pre-migration row whose plaintext was never persisted). The reveal endpoint
 * maps this to HTTP 410. Never carries the secret or any crypto internals.
 */
export class KeySecretNotRecoverableError extends Error {
  constructor() {
    super("secret is not recoverable for this key");
    this.name = "KeySecretNotRecoverableError";
  }
}

/**
 * Raised when an API-key ciphertext cannot be decrypted: malformed envelope,
 * no matching key in the ring, or an AEAD auth-tag failure. Fail-closed; never
 * swallows the underlying cause silently — it is surfaced server-side only.
 */
export class KeySecretDecryptionError extends Error {
  constructor(cause?: unknown) {
    super(
      cause instanceof Error
        ? `failed to decrypt API key secret: ${cause.message}`
        : "failed to decrypt API key secret",
    );
    this.name = "KeySecretDecryptionError";
    if (cause !== undefined && cause instanceof Error) {
      this.cause = cause;
    }
  }
}

/** Raised when a reveal/create is attempted on a revoked API key. */
export class ApiKeyRevokedError extends Error {
  constructor() {
    super("API key is revoked");
    this.name = "ApiKeyRevokedError";
  }
}

/**
 * Raised when an API-key operation requires `API_KEY_ENCRYPTION_KEY` but it is
 * unset. Surfaces only at the api-keys feature level, not on unrelated routes.
 */
export class KeyEncryptionNotConfiguredError extends Error {
  constructor() {
    super("API_KEY_ENCRYPTION_KEY must be set to enable API key storage");
    this.name = "KeyEncryptionNotConfiguredError";
  }
}

/**
 * Typed config error for a malformed `API_KEY_ENCRYPTION_KEY` (or previous):
 * must be base64-decoding to exactly 32 bytes.
 */
export class KeyEncryptionKeyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyEncryptionKeyConfigError";
  }
}
