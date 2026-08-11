/**
 * Pure composition root: wire services with the Drizzle transport.
 *
 * No side effects — no `serve()`, no `process.env` reads at module top level.
 * Route handlers call `composeServices()` with their own config.
 */

import { DrizzleTransport } from "./adapters/db/index";
import type { Config } from "./config";
import { GetWebhookConfigService } from "./service/get-webhook-config";
import { SendMessageService } from "./service/send-message";
import { SessionService } from "./service/session";
import { WebhookConfigManagementService } from "./service/webhook-config-management";
import type { SendMessagePort } from "./ports/send-message";
import type { SessionServicePort } from "./ports/session-service";
import type { WebhookConfigProvider } from "./ports/webhook-config-provider";
import type { WebhookConfigManagementServicePort } from "./service/webhook-config-management";

export interface WiredServices {
  sessionService: SessionServicePort;
  webhookConfig: WebhookConfigProvider;
  webhookManagement: WebhookConfigManagementServicePort;
  sendMessage: SendMessagePort;
  config: Config;
}

export function composeServices(config: Config): WiredServices {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL must be set to serve the API");
  }

  // DrizzleTransport implements JobTransport, SessionTransport, and
  // WebhookConfigManagementTransport.
  const transport = new DrizzleTransport();

  const sendMessage: SendMessagePort = new SendMessageService({
    transport,
    sendTimeoutMs: config.sendTimeoutMs,
    resultPollMs: config.resultPollMs,
  });

  const webhookConfig: WebhookConfigProvider = new GetWebhookConfigService(transport);

  const sessionService: SessionServicePort = new SessionService(transport, transport);

  const webhookManagement = new WebhookConfigManagementService(transport);

  return {
    sessionService,
    webhookConfig,
    webhookManagement,
    sendMessage,
    config,
  };
}
