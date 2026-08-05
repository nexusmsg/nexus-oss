# API — Configuration

All values are read from environment variables. Source:
`services/api/src/config.ts` (`loadConfig`).

| Env var | Default | Description |
|---------|---------|-------------|
| `PORT` | `3000` | HTTP listen port |
| `SUPABASE_URL` | — (required) | PostgREST endpoint (e.g. `http://localhost:3001`) |
| `SUPABASE_SERVICE_ROLE_KEY` | — (required) | Service-role key; dev = HS256 JWT `{"role":"postgres"}` signed with `PGRST_JWT_SECRET` |
| `API_AUTH_TOKEN` | `` (empty) | Bearer token for public WABA routes; empty disables auth |
| `INTERNAL_TOKEN` | `` (empty) | Bearer token for `/internal/*` routes; empty disables them (401) |
| `SEND_TIMEOUT_MS` | `25000` | Max wall-clock time to wait for a job terminal state |
| `RESULT_POLL_MS` | `250` | Delay between job status polls |

## Notes

- Supabase-hosted setups also pass `SUPABASE_ANON_KEY` in the compose
  environment; the service role key is what the transport uses.
- Dev defaults live in `.env.example` and `docker-compose.yml`; the compose
  stack runs without a `.env` file.
