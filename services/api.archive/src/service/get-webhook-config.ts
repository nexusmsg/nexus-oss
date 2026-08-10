/**
 * Application service implementing WebhookConfigProvider: thin delegation to
 * the driven JobTransport port.
 */

import type { WebhookConfig } from "../domain/webhook-config.js";
import type { JobTransport } from "../ports/job-transport.js";
import type { WebhookConfigProvider } from "../ports/webhook-config-provider.js";

export class GetWebhookConfigService implements WebhookConfigProvider {
  private readonly transport: JobTransport;

  constructor(transport: JobTransport) {
    this.transport = transport;
  }

  async get(phoneNumberId: string): Promise<WebhookConfig | null> {
    return this.transport.getWebhookConfig(phoneNumberId);
  }
}

/** Compile-time assertion (Go convention): GetWebhookConfigService implements WebhookConfigProvider. */
const _: WebhookConfigProvider = undefined as unknown as GetWebhookConfigService;
