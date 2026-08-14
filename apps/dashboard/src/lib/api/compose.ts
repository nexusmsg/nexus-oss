/**
 * Pure composition root: wire services with the Drizzle transport.
 *
 * No side effects — no `serve()`, no `process.env` reads at module top level.
 * Route handlers call `composeServices()` with their own config.
 */

import { DrizzleTransport } from "./adapters/db/index";
import { FetchWebhookForwarder } from "./adapters/webhook-forwarder";
import type { Config } from "./config";
import { ApiKeyManagementService } from "./service/api-key-management";
import type { ApiKeyManagementServicePort } from "./service/api-key-management";
import { GetWebhookConfigService } from "./service/get-webhook-config";
import { SendMessageService } from "./service/send-message";
import { SessionService } from "./service/session";
import { WebhookConfigManagementService } from "./service/webhook-config-management";
import type { TestWebhookServicePort } from "./service/webhook-test";
import { TestWebhookService } from "./service/webhook-test";
import type { SendMessagePort } from "./ports/send-message";
import type { SessionServicePort } from "./ports/session-service";
import type { WebhookConfigProvider } from "./ports/webhook-config-provider";
import type { WebhookConfigManagementServicePort } from "./service/webhook-config-management";
import type { ApiKeyAuthPort } from "./server-auth";

export interface WiredServices {
  sessionService: SessionServicePort;
  webhookConfig: WebhookConfigProvider;
  webhookManagement: WebhookConfigManagementServicePort;
  sendMessage: SendMessagePort;
  webhookTest: TestWebhookServicePort;
  apiKeys: ApiKeyManagementServicePort;
  /** Persisted-key lookup + throttled last-used tracking for the public authorizer (API-5b). */
  apiKeyAuth: ApiKeyAuthPort;
  config: Config;
}

export function composeServices(config: Config): WiredServices {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL must be set to serve the API");
  }

  // DrizzleTransport implements JobTransport, SessionTransport,
  // WebhookConfigManagementTransport, and ApiKeyTransport.
  const transport = new DrizzleTransport();

  const sendMessage: SendMessagePort = new SendMessageService({
    transport,
    sendTimeoutMs: config.sendTimeoutMs,
    resultPollMs: config.resultPollMs,
  });

  const webhookConfig: WebhookConfigProvider = new GetWebhookConfigService(transport);

  const sessionService: SessionServicePort = new SessionService(transport, transport);

  const webhookManagement = new WebhookConfigManagementService(transport);

  // One-shot webhook test: separate service + fetch forwarder, no persistence.
  const webhookTest: TestWebhookServicePort = new TestWebhookService({
    transport,
    forwarder: new FetchWebhookForwarder(),
    timeoutMs: config.webhookTestTimeoutMs,
  });

  const apiKeys: ApiKeyManagementServicePort = new ApiKeyManagementService(transport, {
    environment: undefined,
    encryptionKeys: {
      current: config.apiKeyEncryptionKey,
      previous: config.apiKeyEncryptionKeyPrevious,
    },
  });

  // Memoized startup NULL-ciphertext alarm: logs (never throws/blocks) if any
  // key created after the ciphertext migration has a NULL ciphertext, which
  // indicates the encryption key was unset at create time.
  void runNullCiphertextAlarm(transport);

  // The transport satisfies the authorizer's persisted-key port structurally
  // (getKeyByHash + touchKeyLastUsed); expose only that slice.
  const apiKeyAuth: ApiKeyAuthPort = transport;

  return {
    sessionService,
    webhookConfig,
    webhookManagement,
    sendMessage,
    webhookTest,
    apiKeys,
    apiKeyAuth,
    config,
  };
}

/**
 * Fixed timestamp of the `key_ciphertext` migration. Keys created after this
 * with a NULL ciphertext indicate the encryption key was unset at create time.
 */
const CIPHERTEXT_MIGRATION_AT = new Date("2026-08-13T00:00:00Z");

/**
 * Memoized, fire-and-forget startup alarm. Runs once on the first
 * `composeServices()` call. Counts API keys created after the ciphertext
 * migration that still have a NULL ciphertext and logs an alarm via
 * `console.error` if any exist. Never throws and never blocks requests — a
 * failure here is logged and swallowed.
 */
let nullCiphertextAlarmPromise: Promise<void> | null = null;
function runNullCiphertextAlarm(transport: DrizzleTransport): Promise<void> {
  if (nullCiphertextAlarmPromise === null) {
    nullCiphertextAlarmPromise = (async () => {
      try {
        const count = await transport.countUnencryptedKeysSince(CIPHERTEXT_MIGRATION_AT);
        if (count > 0) {
          console.error(
            `[api-key-alarm] ${count} API key(s) created after ` +
              `${CIPHERTEXT_MIGRATION_AT.toISOString()} have a NULL ciphertext ` +
              `(api_keys.key_ciphertext). This usually means API_KEY_ENCRYPTION_KEY ` +
              `was unset at create time — those secrets are not recoverable for reveal.`,
          );
        }
      } catch (err) {
        console.error(
          `[api-key-alarm] failed to count unencrypted keys: ` +
            `${(err as Error).message}`,
        );
      }
    })();
  }
  return nullCiphertextAlarmPromise;
}
