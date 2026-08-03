/**
 * Composition root: load config, build the Supabase transport, wire the
 * application services, create the app, and serve it.
 */

import { serve } from "@hono/node-server";
import { createClient } from "@supabase/supabase-js";
import { createApp } from "./adapters/http/app.js";
import { SupabaseTransport } from "./adapters/supabase/transport.js";
import { loadConfig } from "./config.js";
import type { WebhookConfig } from "./domain/webhook-config.js";
import type { JobTransport } from "./ports/job-transport.js";
import type { SendMessagePort, SendMessageResult } from "./ports/send-message.js";
import type { WebhookConfigProvider } from "./ports/webhook-config-provider.js";
import { GetWebhookConfigService } from "./service/get-webhook-config.js";
import { SendMessageService } from "./service/send-message.js";

const config = loadConfig();

function buildApp() {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to serve the API",
    );
  }
  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  const transport: JobTransport = new SupabaseTransport(supabase);
  const sendMessage: SendMessagePort = new SendMessageService({
    transport,
    sendTimeoutMs: config.sendTimeoutMs,
    resultPollMs: config.resultPollMs,
  });
  const webhookConfig: WebhookConfigProvider = new GetWebhookConfigService(transport);
  return createApp({ sendMessage, webhookConfig, config });
}

/**
 * In test mode the app is importable without a live Supabase instance, but the
 * real ports are stubbed to fail loudly. Tests should build their own app via
 * `createApp()` with fakes.
 */
class NullSendMessagePort implements SendMessagePort {
  send(): Promise<SendMessageResult> {
    return Promise.reject(
      new Error("SendMessagePort is unavailable when NODE_ENV=test; use createApp() with fakes"),
    );
  }
}

class NullWebhookConfigProvider implements WebhookConfigProvider {
  get(_phoneNumberId: string): Promise<WebhookConfig | null> {
    return Promise.reject(
      new Error(
        "WebhookConfigProvider is unavailable when NODE_ENV=test; use createApp() with fakes",
      ),
    );
  }
}

const app =
  process.env.NODE_ENV === "test"
    ? createApp({
        sendMessage: new NullSendMessagePort(),
        webhookConfig: new NullWebhookConfigProvider(),
        config,
      })
    : buildApp();

export default app;

if (process.env.NODE_ENV !== "test") {
  serve({ fetch: app.fetch, port: config.port });
}
