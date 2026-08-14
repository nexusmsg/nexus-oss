import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptApiKeySecret,
  encryptApiKeySecret,
  parseApiKeyEncryptionKey,
} from "./api-key-cipher";
import {
  KeyEncryptionKeyConfigError,
  KeySecretDecryptionError,
} from "../domain/errors";

/** Make a base64 32-byte key. */
function makeKey(): string {
  return randomBytes(32).toString("base64");
}

function keyBuffer(raw: string): Buffer {
  return Buffer.from(raw, "base64");
}

describe("api-key-cipher", () => {
  describe("round-trip", () => {
    it("encrypts then decrypts with the same key", () => {
      const raw = makeKey();
      const key = keyBuffer(raw);
      const secret = "waba_dev_abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

      const envelope = encryptApiKeySecret(secret, key);
      expect(envelope.startsWith("v1.")).toBe(true);

      const ring = { current: key };
      expect(decryptApiKeySecret(envelope, ring)).toBe(secret);
    });

    it("decrypts with the current key when only current is set", () => {
      const raw = makeKey();
      const key = keyBuffer(raw);
      const envelope = encryptApiKeySecret("hello", key);
      expect(decryptApiKeySecret(envelope, { current: key })).toBe("hello");
    });
  });

  describe("key rotation", () => {
    it("decrypts ciphertext from K1 with ring { current: K2, previous: K1 }", () => {
      const k1 = keyBuffer(makeKey());
      const k2 = keyBuffer(makeKey());
      const secret = "waba_dev_secretvalue";

      // Encrypt with K1 (the key that was current at create time).
      const envelope = encryptApiKeySecret(secret, k1);

      // After rotation: K2 is current, K1 is previous.
      const ring = { current: k2, previous: k1 };
      expect(decryptApiKeySecret(envelope, ring)).toBe(secret);
    });
  });

  describe("tamper detection", () => {
    function parts(envelope: string): string[] {
      return envelope.split(".");
    }

    it("throws on a flipped ciphertext byte", () => {
      const key = keyBuffer(makeKey());
      const envelope = encryptApiKeySecret("tamper-me", key);
      const p = parts(envelope);
      const ct = Buffer.from(p[4], "base64");
      ct[0] ^= 0xff;
      p[4] = ct.toString("base64");
      expect(() =>
        decryptApiKeySecret(p.join("."), { current: key }),
      ).toThrow(KeySecretDecryptionError);
    });

    it("throws on a flipped auth tag byte", () => {
      const key = keyBuffer(makeKey());
      const envelope = encryptApiKeySecret("tamper-tag", key);
      const p = parts(envelope);
      const tag = Buffer.from(p[3], "base64");
      tag[0] ^= 0xff;
      p[3] = tag.toString("base64");
      expect(() =>
        decryptApiKeySecret(p.join("."), { current: key }),
      ).toThrow(KeySecretDecryptionError);
    });

    it("throws on a flipped iv byte", () => {
      const key = keyBuffer(makeKey());
      const envelope = encryptApiKeySecret("tamper-iv", key);
      const p = parts(envelope);
      const iv = Buffer.from(p[2], "base64");
      iv[0] ^= 0xff;
      p[2] = iv.toString("base64");
      expect(() =>
        decryptApiKeySecret(p.join("."), { current: key }),
      ).toThrow(KeySecretDecryptionError);
    });

    it("throws on a flipped keyId byte", () => {
      const key = keyBuffer(makeKey());
      const envelope = encryptApiKeySecret("tamper-keyid", key);
      const p = parts(envelope);
      // Flip the last char of the 8-char keyId.
      const id = p[1].split("");
      id[id.length - 1] = id[id.length - 1] === "a" ? "b" : "a";
      p[1] = id.join("");
      expect(() =>
        decryptApiKeySecret(p.join("."), { current: key }),
      ).toThrow(KeySecretDecryptionError);
    });
  });

  describe("wrong key / unknown keyId", () => {
    it("throws when the ring has no matching key", () => {
      const key = keyBuffer(makeKey());
      const other = keyBuffer(makeKey());
      const envelope = encryptApiKeySecret("wrong-key", key);
      expect(() =>
        decryptApiKeySecret(envelope, { current: other }),
      ).toThrow(KeySecretDecryptionError);
    });

    it("throws when keyId matches neither current nor previous", () => {
      const k1 = keyBuffer(makeKey());
      const k2 = keyBuffer(makeKey());
      const k3 = keyBuffer(makeKey());
      const envelope = encryptApiKeySecret("unknown", k1);
      expect(() =>
        decryptApiKeySecret(envelope, { current: k2, previous: k3 }),
      ).toThrow(KeySecretDecryptionError);
    });
  });

  describe("malformed envelope", () => {
    const key = keyBuffer(makeKey());

    it("throws on 3 parts", () => {
      const envelope = "v1.deadbeef." + key.toString("base64");
      expect(() =>
        decryptApiKeySecret(envelope, { current: key }),
      ).toThrow(KeySecretDecryptionError);
    });

    it("throws on 4 parts", () => {
      const envelope = "v1.deadbeef.a.b";
      expect(() =>
        decryptApiKeySecret(envelope, { current: key }),
      ).toThrow(KeySecretDecryptionError);
    });

    it("throws on non-v1 version", () => {
      const envelope = "v2.deadbeef.a.b.c";
      expect(() =>
        decryptApiKeySecret(envelope, { current: key }),
      ).toThrow(KeySecretDecryptionError);
    });

    it("throws when IV is not 12 bytes", () => {
      const iv = Buffer.from("tooshort").toString("base64");
      const tag = key.toString("base64"); // wrong length, also exercised
      const ct = key.toString("base64");
      const envelope = `v1.deadbeef.${iv}.${tag}.${ct}`;
      expect(() =>
        decryptApiKeySecret(envelope, { current: key }),
      ).toThrow(KeySecretDecryptionError);
    });

    it("throws when tag is not 16 bytes", () => {
      const iv = randomBytes(12).toString("base64");
      const tag = Buffer.from("not16").toString("base64");
      const ct = randomBytes(8).toString("base64");
      const envelope = `v1.deadbeef.${iv}.${tag}.${ct}`;
      expect(() =>
        decryptApiKeySecret(envelope, { current: key }),
      ).toThrow(KeySecretDecryptionError);
    });

    it("throws on an empty segment", () => {
      const iv = randomBytes(12).toString("base64");
      const tag = randomBytes(16).toString("base64");
      const ct = randomBytes(8).toString("base64");
      const envelope = `v1.deadbeef..${tag}.${ct}`;
      expect(() =>
        decryptApiKeySecret(envelope, { current: key }),
      ).toThrow(KeySecretDecryptionError);
    });

    it("throws on bad base64", () => {
      const envelope = `v1.deadbeef.@@@.@@@.@@@`;
      expect(() =>
        decryptApiKeySecret(envelope, { current: key }),
      ).toThrow(KeySecretDecryptionError);
    });
  });

  describe("parseApiKeyEncryptionKey", () => {
    it("throws on empty value", () => {
      expect(() => parseApiKeyEncryptionKey("")).toThrow(
        KeyEncryptionKeyConfigError,
      );
    });

    it("throws on missing/undefined value", () => {
      expect(() => parseApiKeyEncryptionKey(undefined as unknown as string)).toThrow(
        KeyEncryptionKeyConfigError,
      );
    });

    it("throws when decoded is not 32 bytes", () => {
      const raw = randomBytes(16).toString("base64"); // 16 bytes
      expect(() => parseApiKeyEncryptionKey(raw)).toThrow(
        KeyEncryptionKeyConfigError,
      );
    });

    it("returns a 32-byte Buffer for a valid base64 key", () => {
      const raw = randomBytes(32).toString("base64");
      const key = parseApiKeyEncryptionKey(raw);
      expect(Buffer.isBuffer(key)).toBe(true);
      expect(key.length).toBe(32);
    });
  });
});
