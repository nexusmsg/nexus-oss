/**
 * Vercel serverless entry for the WABA API.
 *
 * IMPORTANT: this module must never start a listener. It only composes the
 * app (via the shared, side-effect-free `buildApp`) and exports the Hono
 * request handler for Vercel's `api/` directory runtime. A top-level `serve()`
 * here would open a port at import time and break the deployment.
 *
 * `export const config` pins the Node.js runtime and a 30s max duration, which
 * comfortably covers the default SEND_TIMEOUT_MS (25000) sync-wait window.
 * `buildApp` throws at module load if SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 * are unset — that is the intended fail-fast behavior on Vercel, where those
 * env vars are configured in the project dashboard.
 */

import { handle } from "hono/vercel";
import { buildApp } from "../src/compose.js";
import { loadConfig } from "../src/config.js";

export const config = { runtime: "nodejs", maxDuration: 30 };

const app = buildApp(loadConfig());
export default handle(app);
