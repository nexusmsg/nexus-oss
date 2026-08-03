import { serve } from "@hono/node-server";
import { createClient } from "@supabase/supabase-js";
import { createApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { SupabaseTransport, type JobTransport, type PollResult, type WebhookConfigRow } from "./transport.js";

const config = loadConfig();

function buildTransport(cfg: Config): JobTransport {
  if (!cfg.supabaseUrl || !cfg.supabaseServiceRoleKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to serve the API",
    );
  }
  const supabase = createClient(cfg.supabaseUrl, cfg.supabaseServiceRoleKey);
  return new SupabaseTransport(supabase);
}

/**
 * In test mode the app is importable without a live Supabase instance; tests
 * build their own app via `createApp()` with a fake transport. Any use of the
 * real transport path in tests fails loudly instead of touching the network.
 */
class NullTransport implements JobTransport {
  private unavailable(): never {
    throw new Error(
      "JobTransport is unavailable when NODE_ENV=test; use createApp() with a fake transport",
    );
  }

  enqueue(): Promise<string> {
    return this.unavailable();
  }

  poll(_serial: string): Promise<PollResult | null> {
    return this.unavailable();
  }

  getWebhookConfig(_phoneNumberId: string): Promise<WebhookConfigRow | null> {
    return this.unavailable();
  }
}

const app =
  process.env.NODE_ENV === "test"
    ? createApp({ transport: new NullTransport(), config })
    : createApp({ transport: buildTransport(config), config });

export default app;

if (process.env.NODE_ENV !== "test") {
  serve({ fetch: app.fetch, port: config.port });
}
