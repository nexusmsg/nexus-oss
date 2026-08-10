/**
 * Local dev server entry: load config, compose the app, and serve it via
 * `@hono/node-server`. The Vercel entry lives in `api/index.ts` and uses the
 * same `buildApp` without starting a listener.
 */

import { serve } from "@hono/node-server";
import { buildApp } from "./compose.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = buildApp(config);

export default app;

if (process.env.NODE_ENV !== "test") {
  serve({ fetch: app.fetch, port: config.port });
}
