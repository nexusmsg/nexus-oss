# API — Configuration

All values are read from environment variables. Source:
`services/api/src/config.ts` (`loadConfig`).

| Env var | Default | Description |
|---------|---------|-------------|
| `PORT` | `3000` | HTTP listen port |
| `SUPABASE_URL` | — (required) | PostgREST endpoint (e.g. `http://localhost:3001`) |
| `SUPABASE_SERVICE_ROLE_KEY` | — (required) | Service-role key; dev = HS256 JWT `{"role":"postgres"}` signed with `PGRST_JWT_SECRET` |
| `API_AUTH_TOKEN` | `` (empty) | Shared secret for public WABA routes and `/api/v1/*`; accepted as Bearer **or** Basic (password = `API_AUTH_TOKEN`); empty disables auth |
| `INTERNAL_TOKEN` | `` (empty) | Bearer token for `/internal/*` routes; empty disables them (401) |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allow-list of origins allowed to call `/api/v1/*` cross-origin; empty string disables CORS |
| `SEND_TIMEOUT_MS` | `25000` | Max wall-clock time to wait for a job terminal state |
| `RESULT_POLL_MS` | `250` | Delay between job status polls |

## Notes

- **Auth (`src/adapters/http/auth.ts`)** accepts either
  `Authorization: Bearer <API_AUTH_TOKEN>` or
  `Authorization: Basic base64(<user>:<API_AUTH_TOKEN>)` against the same
  `API_AUTH_TOKEN` secret. The username is free-form (e.g. `nexus`); the
  password must equal the token. Bearer takes precedence when both schemes are
  present. Empty `API_AUTH_TOKEN` disables auth for both schemes. All auth
  failures return `401` with `WWW-Authenticate: Basic realm="nexus"` so
  browser-native Basic Auth (and reverse proxies) can drive the prompt.
- **CORS (`/api/v1/*`)** uses Hono's built-in `cors` middleware, allowing
  methods `GET/POST/PATCH/DELETE/OPTIONS` and headers `Authorization`,
  `Content-Type`. Credentials are not enabled (Basic is sent as a header, not a
  cookie). An empty `CORS_ORIGINS` skips registering the middleware entirely.
- Supabase-hosted setups also pass `SUPABASE_ANON_KEY` in the compose
  environment; the service role key is what the transport uses.
- Dev defaults live in `.env.example` and `docker-compose.yml`; the compose
  stack runs without a `.env` file.
