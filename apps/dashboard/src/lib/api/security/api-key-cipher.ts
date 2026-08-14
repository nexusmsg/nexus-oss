/**
 * AES-256-GCM encryption for API-key plaintext secrets, stored encrypted-at-rest
 * in `api_keys.key_ciphertext`.
 *
 * Pure crypto helper — depends only on `node:crypto`. Used by the API-key
 * service; never imported by the domain or ports layers (which stay node-free).
 *
 * Envelope format (single line, dot-separated, 5 parts):
 *   v1.<keyId>.<b64(iv)>.<b64(tag)>.<b64(ciphertext)>
 * - `keyId` = first 8 hex chars of SHA-256(key); identifies which ring key
 *   encrypted the blob so rotation is zero-downtime (the previous key stays
 *   readable until re-encrypted).
 * - `iv` = 12 random bytes (AES-GCM standard nonce).
 * - `tag` = 16-byte GCM auth tag (`cipher.getAuthTag()`).
 * - base64 = standard (non-url-safe) encoding.
 *
 * Strict parsing fails closed on any malformed input: wrong part count,
 * non-`v1` prefix, IV not exactly 12 bytes, tag not exactly 16 bytes, empty
 * segments, or bad base64. Decryption matches the envelope `keyId` against the
 * ring (current, then previous) and throws `KeySecretDecryptionError` on any
 * mismatch, auth-tag failure, or throw.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import {
  KeyEncryptionKeyConfigError,
  KeySecretDecryptionError,
} from "../domain/errors";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const ENVELOPE_VERSION = "v1";
const KEY_ID_LENGTH = 8;

export interface KeyRing {
  /** Current (encryption) key. */
  current: Buffer;
  /** Previous key, retained for reads during rotation. Optional. */
  previous?: Buffer;
}

export interface KeyRingRaw {
  /** Raw env string (base64) for the current key. */
  current: string;
  /** Raw env string (base64) for the previous key. Optional. */
  previous?: string;
}

/** Encrypt a plaintext secret with the current ring key. Returns the envelope. */
export function encryptApiKeySecret(secret: string, key: Buffer): string {
  if (key.length !== KEY_LENGTH) {
    throw new KeySecretDecryptionError(
      new Error(`encryption key must be ${KEY_LENGTH} bytes`),
    );
  }
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const keyId = keyIdOf(key);
  return [
    ENVELOPE_VERSION,
    keyId,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

/**
 * Decrypt an envelope with the configured ring. Matches the envelope `keyId`
 * against current then previous; throws `KeySecretDecryptionError` on no match,
 * auth-tag failure, or any malformed input.
 */
export function decryptApiKeySecret(envelope: string, ring: KeyRing): string {
  const { keyId, iv, tag, ciphertext } = parseEnvelope(envelope);

  const candidates: Buffer[] = [ring.current];
  if (ring.previous !== undefined) {
    candidates.push(ring.previous);
  }

  let lastErr: unknown = null;
  for (const key of candidates) {
    if (keyIdOf(key) !== keyId) {
      continue;
    }
    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
      return plaintext.toString("utf8");
    } catch (err) {
      // Auth-tag failure / wrong key for a keyId match → fail closed.
      lastErr = err;
    }
  }

  throw new KeySecretDecryptionError(
    lastErr instanceof Error ? lastErr : new Error("no matching key for envelope"),
  );
}

/** First 8 hex chars of SHA-256(key); identifies the ring key in the envelope. */
function keyIdOf(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, KEY_ID_LENGTH);
}

/**
 * Strict envelope parser. Returns decoded buffers, failing closed with
 * `KeySecretDecryptionError` on any malformed input.
 */
function parseEnvelope(envelope: string): {
  keyId: string;
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
} {
  if (typeof envelope !== "string" || envelope.length === 0) {
    throw new KeySecretDecryptionError(new Error("envelope is empty"));
  }
  const parts = envelope.split(".");
  if (parts.length !== 5) {
    throw new KeySecretDecryptionError(
      new Error(`envelope must have 5 parts, got ${parts.length}`),
    );
  }
  const [version, keyId, ivB64, tagB64, ctB64] = parts;

  if (version !== ENVELOPE_VERSION) {
    throw new KeySecretDecryptionError(
      new Error(`unsupported envelope version: ${String(version)}`),
    );
  }
  if (keyId.length !== KEY_ID_LENGTH) {
    throw new KeySecretDecryptionError(new Error("malformed keyId"));
  }
  if (ivB64 === "" || tagB64 === "" || ctB64 === "") {
    throw new KeySecretDecryptionError(new Error("envelope has empty segment"));
  }

  let iv: Buffer;
  let tag: Buffer;
  let ciphertext: Buffer;
  try {
    iv = Buffer.from(ivB64, "base64");
    tag = Buffer.from(tagB64, "base64");
    ciphertext = Buffer.from(ctB64, "base64");
  } catch (err) {
    throw new KeySecretDecryptionError(
      new Error(`envelope base64 decode failed: ${(err as Error).message}`),
    );
  }

  if (iv.length !== IV_LENGTH) {
    throw new KeySecretDecryptionError(
      new Error(`iv must be ${IV_LENGTH} bytes, got ${iv.length}`),
    );
  }
  if (tag.length !== TAG_LENGTH) {
    throw new KeySecretDecryptionError(
      new Error(`tag must be ${TAG_LENGTH} bytes, got ${tag.length}`),
    );
  }

  return { keyId, iv, tag, ciphertext };
}

/**
 * Parse a raw base64 env value into a 32-byte key. Throws
 * `KeyEncryptionKeyConfigError` when the value is missing, empty, or does not
 * decode to exactly 32 bytes.
 */
export function parseApiKeyEncryptionKey(raw: string): Buffer {
  if (raw === undefined || raw === null || raw.trim() === "") {
    throw new KeyEncryptionKeyConfigError(
      "API_KEY_ENCRYPTION_KEY must be a non-empty base64 value",
    );
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch (err) {
    throw new KeyEncryptionKeyConfigError(
      `API_KEY_ENCRYPTION_KEY is not valid base64: ${(err as Error).message}`,
    );
  }
  if (key.length !== KEY_LENGTH) {
    throw new KeyEncryptionKeyConfigError(
      `API_KEY_ENCRYPTION_KEY must decode to ${KEY_LENGTH} bytes, got ${key.length}`,
    );
  }
  return key;
}
