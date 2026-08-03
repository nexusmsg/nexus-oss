/**
 * Pure composition root: build the fully-wired Hono app from a `Config`.
 *
 * No side effects — no `serve()`, no `process.env` reads at module top level.
 * Both the local dev server (`src/index.ts`) and the Vercel entry
 * (`api/index.ts`) call `buildApp(config)` with their own config.
 */

import { createClient } from "@supabase/supabase-js";
import type { Hono } from "hono";
import { createApp } from "./adapters/http/app.js";
import { SupabaseTransport } from "./adapters/supabase/transport.js";
import type { Config } from "./config.js";
import type { JobTransport } from "./ports/job-transport.js";
import type { SendMessagePort } from "./ports/send-message.js";
import type { WebhookConfigProvider } from "./ports/webhook-config-provider.js";
import { GetWebhookConfigService } from "./service/get-webhook-config.js";
import { SendMessageService } from "./service/send-message.js";

export function buildApp(config: Config): Hono {
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
