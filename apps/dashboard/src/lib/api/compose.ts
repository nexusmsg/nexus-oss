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

export interface WiredServices {
  sessionService: SessionServicePort;
  webhookConfig: WebhookConfigProvider;
  webhookManagement: WebhookConfigManagementServicePort;
  sendMessage: SendMessagePort;
  webhookTest: TestWebhookServicePort;
  apiKeys: ApiKeyManagementServicePort;
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

  const apiKeys: ApiKeyManagementServicePort = new ApiKeyManagementService(transport);

  return {
    sessionService,
    webhookConfig,
    webhookManagement,
    sendMessage,
    webhookTest,
    apiKeys,
    config,
  };
}
