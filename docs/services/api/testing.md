# API — Testing

## Unit tests (hermetic)

Vitest, no external services. All fakes/mocks are in-memory.

```bash
cd services/api
npm test
```

Result: `139 passed` (10 test files), `tsc` clean.

## Integration tests (live stack)

`src/adapters/http/app.integration.test.ts` runs the **real** Hono app against
a real PostgREST + Postgres. Gated by `TEST_SUPABASE_URL` — skipped when unset.

```bash
TEST_SUPABASE_URL=http://localhost:3001 \
TEST_SUPABASE_SERVICE_ROLE_KEY=<dev-jwt> \
npx vitest run src/adapters/http/app.integration.test.ts
```

Requirements:

- Migrations 000001–000005 applied (`docker compose up -d postgres postgrest migrate`,
  then `docker compose restart postgrest` to reload the schema cache).
- Dev JWT from `.env.example` (role `postgres`, signed with `PGRST_JWT_SECRET`).

Result: `25 passed`. Test rows use a unique `itest-<timestamp>-` prefix and are
hard-deleted in `afterAll`.

## Test layout

| File | Covers |
|------|--------|
| `adapters/http/app.test.ts` | Route handlers, auth, error envelopes, session/webhook JSON |
| `adapters/supabase/transport.test.ts` | PostgREST query building, `business_account_id` insert mapping |
| `domain/*.test.ts` | Session, outbound-message, webhook-config models |
| `service/*.test.ts` | Send-message, session, webhook-config management use cases |
