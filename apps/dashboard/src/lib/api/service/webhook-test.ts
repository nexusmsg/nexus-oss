/**
 * Application service implementing the one-shot webhook test: loads a config
 * by serial, builds a deterministic synthetic inbound WABA `messages` payload,
 * signs it with the plaintext secret (`X-Hub-Signature-256`), guards the
 * target URL against SSRF at resolve time, and POSTs it through the driven
 * WebhookForwarder port. Imports only domain + ports (+ node stdlib).
 *
 * Testing disabled/paused configs is allowed — no `enabled` check. No delivery
 * log or persistence is written.
 */

import { createHmac } from "node:crypto";
import { resolve4, resolve6 } from "node:dns/promises";
import { RequestAbortedError, ValidationError } from "../domain/errors";
import type { WebhookConfig } from "../domain/webhook-config";
import type {
  SyntheticWebhookPayload,
  WebhookProbeErrorCode,
  WebhookProbeResult,
} from "../domain/webhook-test";
import type { WebhookConfigManagementTransport } from "../ports/webhook-config-management";
import type {
  WebhookForwarder,
  WebhookForwardResult,
} from "../ports/webhook-forwarder";

/** Resolves a hostname to its A/AAAA addresses. */
export type ResolveAddresses = (hostname: string) => Promise<string[]>;

export interface TestWebhookServiceDeps {
  transport: WebhookConfigManagementTransport;
  forwarder: WebhookForwarder;
  /** Per-probe wall-clock budget (ms) handed to the forwarder. */
  timeoutMs: number;
  /** DNS resolver override for tests; defaults to `node:dns/promises`. */
  resolveAddresses?: ResolveAddresses;
}

/** Application-facing port for the one-shot webhook test (HTTP adapter depends on this). */
export interface TestWebhookServicePort {
  /** Returns null when the serial has no webhook config. */
  test(serial: string, signal?: AbortSignal): Promise<WebhookProbeResult | null>;
}

export class TestWebhookService implements TestWebhookServicePort {
  private readonly transport: WebhookConfigManagementTransport;
  private readonly forwarder: WebhookForwarder;
  private readonly timeoutMs: number;
  private readonly resolveAddresses: ResolveAddresses;

  constructor(deps: TestWebhookServiceDeps) {
    this.transport = deps.transport;
    this.forwarder = deps.forwarder;
    this.timeoutMs = deps.timeoutMs;
    this.resolveAddresses = deps.resolveAddresses ?? resolveHostAddresses;
  }

  async test(serial: string, signal?: AbortSignal): Promise<WebhookProbeResult | null> {
    const config = await this.transport.getConfig(serial);
    if (config === null) {
      return null;
    }
    return this.runProbe(config, signal);
  }

  private async runProbe(
    config: WebhookConfig,
    signal?: AbortSignal,
  ): Promise<WebhookProbeResult> {
    const startedAt = Date.now();
    const payload = buildSyntheticWebhookPayload(config);
    const body = JSON.stringify(payload);

    const fail = (
      code: WebhookProbeErrorCode,
      message: string,
      signatureSent: boolean,
    ): WebhookProbeResult => ({
      outcome: "failed",
      ok: false,
      status: null,
      statusText: "",
      headers: {},
      body: null,
      bodyTruncated: false,
      durationMs: Date.now() - startedAt,
      signatureSent,
      error: { code, message },
      payload,
    });

    const parsed = parseWebhookUrl(config.webhookUrl);
    if (!parsed.ok) {
      throw parsed.error; // invalid input → WABA error envelope (400)
    }

    const check = await checkDeliveryTarget(parsed.url, this.resolveAddresses);
    if (!check.ok) {
      return fail(
        check.errorCode ?? "blocked_target",
        check.errorMessage ?? "webhook_url target was rejected",
        false,
      );
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    let signatureSent = false;
    if (config.webhookSecret !== null && config.webhookSecret !== "") {
      headers["X-Hub-Signature-256"] = `sha256=${computeSignature(config.webhookSecret, body)}`;
      signatureSent = true;
    }

    const forward: WebhookForwardResult = await this.forwarder.post({
      url: parsed.url.toString(),
      body,
      headers,
      timeoutMs: this.timeoutMs,
      signal,
    });

    switch (forward.kind) {
      case "response": {
        const { response } = forward;
        return {
          outcome: "responded",
          ok: response.status >= 200 && response.status < 300,
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          body: response.body,
          bodyTruncated: response.bodyTruncated,
          durationMs: Date.now() - startedAt,
          signatureSent,
          error: null,
          payload,
        };
      }
      case "timeout":
        return fail("timeout", "webhook request timed out", signatureSent);
      case "network":
        return fail("network", forward.message, signatureSent);
      case "aborted":
        throw new RequestAbortedError();
    }
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/**
 * Deterministic synthetic inbound WABA `messages` webhook payload. Values are
 * fixed except for the config's phone number id (used for the business-account
 * entry id, metadata, and the message id) so a given config always produces
 * byte-identical output.
 */
export function buildSyntheticWebhookPayload(
  config: WebhookConfig,
): SyntheticWebhookPayload {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: `wa_${config.phoneNumberId}`,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: config.phoneNumberId,
                phone_number_id: config.phoneNumberId,
              },
              contacts: [
                { profile: { name: "Webhook Test" }, wa_id: "14155552671" },
              ],
              messages: [
                {
                  from: "14155552671",
                  id: `wamid.test.${config.phoneNumberId}`,
                  timestamp: "1760000000",
                  type: "text",
                  text: { body: "Webhook delivery test" },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

/**
 * Hex-encoded HMAC-SHA256 of `body` keyed by the plaintext `secret`,
 * matching the worker's `X-Hub-Signature-256` algorithm byte-for-byte
 * (no key derivation).
 */
export function computeSignature(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

export interface DeliveryTargetCheck {
  ok: boolean;
  errorCode?: WebhookProbeErrorCode;
  errorMessage?: string;
}

/**
 * Resolve-time SSRF guard. Literal IPs are checked directly; hostnames are
 * resolved (A + AAAA) and every address is checked against private, loopback,
 * link-local (including the 169.254.169.254 metadata address), and multicast
 * ranges.
 */
export async function checkDeliveryTarget(
  url: URL,
  resolveAddresses: ResolveAddresses,
): Promise<DeliveryTargetCheck> {
  const literal = parseLiteralIp(url.hostname);
  if (literal !== null) {
    if (isBlockedIpAddress(literal)) {
      return {
        ok: false,
        errorCode: "blocked_target",
        errorMessage: `webhook_url targets a blocked address (${literal})`,
      };
    }
    return { ok: true };
  }

  let addresses: string[];
  try {
    addresses = await resolveAddresses(url.hostname);
  } catch {
    return {
      ok: false,
      errorCode: "dns_failed",
      errorMessage: `webhook_url host could not be resolved (${url.hostname})`,
    };
  }
  if (addresses.length === 0) {
    return {
      ok: false,
      errorCode: "dns_failed",
      errorMessage: `webhook_url host could not be resolved (${url.hostname})`,
    };
  }
  for (const address of addresses) {
    if (isBlockedIpAddress(address)) {
      return {
        ok: false,
        errorCode: "blocked_target",
        errorMessage: `webhook_url resolves to a blocked address (${address})`,
      };
    }
  }
  return { ok: true };
}

/**
 * `true` when `ip` (IPv4 or IPv6 string) is in a range that must never be a
 * webhook target: private (RFC 1918 / ULA), loopback, link-local, the
 * cloud metadata address, multicast, broadcast, and unspecified addresses.
 * Non-IP strings return `false`.
 */
export function isBlockedIpAddress(ip: string): boolean {
  const v4 = parseIpv4(ip);
  if (v4 !== null) {
    return isBlockedIpv4(v4);
  }
  const v6 = parseIpv6(ip);
  if (v6 !== null) {
    return isBlockedIpv6(v6);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** Default resolver: A + AAAA records via `node:dns/promises`. */
async function resolveHostAddresses(hostname: string): Promise<string[]> {
  const settled = await Promise.allSettled([resolve4(hostname), resolve6(hostname)]);
  const addresses: string[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      addresses.push(...result.value);
    }
  }
  return addresses;
}

function parseWebhookUrl(
  value: string,
): { ok: true; url: URL } | { ok: false; error: ValidationError } {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return {
        ok: false,
        error: new ValidationError("webhook_url must be a valid http(s) URL"),
      };
    }
    return { ok: true, url };
  } catch {
    return {
      ok: false,
      error: new ValidationError("webhook_url must be a valid http(s) URL"),
    };
  }
}

/** Extract a literal IP from a URL hostname (strips IPv6 brackets). */
function parseLiteralIp(hostname: string): string | null {
  const candidate =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
  if (parseIpv4(candidate) !== null || parseIpv6(candidate) !== null) {
    return candidate;
  }
  return null;
}

function parseIpv4(ip: string): [number, number, number, number] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const octet = Number(part);
    if (octet > 255) {
      return null;
    }
    octets.push(octet);
  }
  return octets as [number, number, number, number];
}

function parseIpv6(ip: string): number[] | null {
  let s = ip.toLowerCase();

  // Trailing dotted-quad (IPv4-mapped / IPv4-compatible forms).
  if (s.includes(".")) {
    const lastColon = s.lastIndexOf(":");
    const v4 = parseIpv4(s.slice(lastColon + 1));
    if (v4 === null) {
      return null;
    }
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    s = `${s.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  let head: string[] = [];
  let tail: string[] = [];
  if (s.includes("::")) {
    if (s.includes(":::")) {
      return null;
    }
    const [h, t] = s.split("::");
    if (h !== "") head = h.split(":");
    if (t !== "") tail = t.split(":");
    if (head.length + tail.length > 7) {
      return null;
    }
  } else {
    const groups = s.split(":");
    if (groups.length !== 8) {
      return null;
    }
    head = groups;
  }

  const hextets: Array<number | null> = [];
  for (const group of head) {
    hextets.push(parseHexGroup(group));
  }
  for (let i = 0; i < 8 - head.length - tail.length; i++) {
    hextets.push(0);
  }
  for (const group of tail) {
    hextets.push(parseHexGroup(group));
  }
  if (hextets.length !== 8 || hextets.some((h) => h === null)) {
    return null;
  }
  return hextets as number[];
}

function parseHexGroup(group: string): number | null {
  if (!/^[0-9a-f]{1,4}$/.test(group)) {
    return null;
  }
  return parseInt(group, 16);
}

function isBlockedIpv4([a, b]: [number, number, number, number]): boolean {
  if (a === 0 || a === 127) return true; // unspecified / loopback
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local incl. metadata
  return a >= 224; // multicast (224/4), reserved (240/4), broadcast
}

function isBlockedIpv6(hextets: number[]): boolean {
  const [h0, h1, h2, h3, h4, h5, h6, h7] = hextets;

  // IPv4-mapped IPv6 (::ffff:a.b.c.d): check the embedded address.
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0xffff) {
    return isBlockedIpv4([
      (h6 >>> 8) & 0xff,
      h6 & 0xff,
      (h7 >>> 8) & 0xff,
      h7 & 0xff,
    ]);
  }
  // Unspecified `::` and loopback `::1`.
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0 && h6 === 0) {
    return true;
  }
  if ((h0 & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA private
  if ((h0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  return (h0 & 0xff00) === 0xff00; // ff00::/8 multicast
}

/** Compile-time assertion (Go convention): TestWebhookService implements the app port. */
const _: TestWebhookServicePort = undefined as unknown as TestWebhookService;
