# API — Configuration

The active API is hosted in the dashboard app (Next.js route handlers under
`apps/dashboard/src/app/api/`; config read in
`apps/dashboard/src/lib/api/config.ts`). All values are read from environment
variables.

| Env var | Default | Description |
|---------|---------|-------------|
| `DATABASE_URL` | — (required) | Postgres connection string used by the Drizzle transport (dashboard) |
| `PORT` | `3000` | HTTP listen port (legacy Hono surface) |
| `SUPABASE_URL` | — (required) | PostgREST endpoint (legacy Hono surface, e.g. `http://localhost:3001`) |
| `SUPABASE_SERVICE_ROLE_KEY` | — (required) | Service-role key (legacy Hono surface); dev = HS256 JWT `{"role":"postgres"}` signed with `PGRST_JWT_SECRET` |
| `API_AUTH_TOKEN` | `` (empty) | Bootstrap Bearer token for `/api/v1/*` and management routes; also the seed credential for persisted API keys. Bearer only; empty closes every public route |
| `API_KEY_ENV` | `NODE_ENV` → `dev` | Environment label embedded in generated key prefixes (`waba_<env>_…`); normalized to `[a-z0-9-]` by the API-key service |
| `API_KEY_ENCRYPTION_KEY` | `` (empty) | Base64 32-byte AES-256-GCM key for API-key secrets at rest (`key_ciphertext`). Required for `POST /api/v1/api-keys` and the reveal route; when unset, create/reveal fail with a config error scoped to the api-keys feature |
| `API_KEY_ENCRYPTION_KEY_PREVIOUS` | `` (empty) | Previous encryption key, retained for reads only during rotation. Set it to the old key before replacing `API_KEY_ENCRYPTION_KEY`; reveals keep working, then drop it once re-encryption/rotation completes |
| `INTERNAL_TOKEN` | `` (empty) | Bearer token for `/internal/*` routes — strictly isolated from `API_AUTH_TOKEN` and persisted keys; empty disables them (401) |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:3002` | Comma-separated allow-list of origins allowed to call `/api/v1/*` cross-origin; empty string disables CORS |
| `SEND_TIMEOUT_MS` | `25000` | Max wall-clock time to wait for a job terminal state |
| `RESULT_POLL_MS` | `250` | Delay between job status polls |

## Notes

- **Auth** accepts `Authorization: Bearer <API_AUTH_TOKEN>` (constant-time
  SHA-256 comparison) or a persisted API key (`waba_…`, SHA-256 hash lookup
  with lifecycle + scope enforcement). Basic auth is no longer accepted.
  Empty `API_AUTH_TOKEN` closes every public route — neither the bootstrap
  token nor persisted keys are accepted. Management routes
  (`/api/v1/api-keys/**`) are bootstrap-only. `/internal/*` routes accept only
  `INTERNAL_TOKEN`; all token comparisons are constant-time.
- **API keys** are created via `POST /api/v1/api-keys`; only the SHA-256
  digest and a `waba_<env>_` prefix are stored, and the plaintext secret is
  returned exactly once at creation.
- **CORS (`/api/v1/*`)** allows methods `GET/POST/PATCH/DELETE/OPTIONS` and
  headers `Authorization`, `Content-Type`. An empty `CORS_ORIGINS` skips
  registering the middleware entirely.
- Dev defaults live in `.env.example` and `docker-compose.yml`; the compose
  stack runs without a `.env` file.
