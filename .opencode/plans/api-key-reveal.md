# API Key Reveal Refactor Plan

> **Status: IMPLEMENTED (2026-08-13).** M0–M5 complete. Evidence: cipher 20/20,
> service 36/36, route+auth matrix 153/153, page 16/16, integration 13/13
> (real DB, migration `000012` applied, version 12 clean); `next build` passes
> with `/api/v1/api-keys/[serial]/secret` registered; lint 0 errors. Full
> dashboard suite: 428 passed, 13 skipped, 9 pre-existing failures in
> `client.test.ts`/`sessions.test.ts` (hardcoded same-origin `getApiBaseUrl()`
> vs stale env-driven test expectations — unrelated, present on HEAD).

## Objective

Let users reveal/copy an API key on demand after creation, instead of only at
generation time. Switch the storage model from hash-only to **hash + AES-256-GCM
ciphertext**, keep the hash as the authentication lookup, add a reveal endpoint
that decrypts **server-side**, and enable the dashboard's Reveal/Copy row
actions.

Decision (user-confirmed): **server-side decryption**. The reveal endpoint is
authenticated and returns plaintext over TLS; encryption protects the DB at
rest. Frontend decryption was rejected: without a user-held key (which this
repo's bootstrap-token-only management model cannot provide), a browser-side key
would cross the same channel as the blob and add no security.

Oracle review (2026-08-13): **approved with changes** — key-ring rotation,
audit logging, NULL-ciphertext alarm, and server-side revoke blocking are
incorporated below.

## Background (current state)

- Key format: `waba_<environment>_<64-hex>`, secret = `randomBytes(32)` (CSPRNG).
  `service/api-key-management.ts:162-165`.
- Storage (migration `000011`): `key_hash` (SHA-256 of full secret, unique
  index) + `key_prefix`. Plaintext returned once from `createKey`; never stored,
  logged, or recoverable (`api-key-management.ts:6-14`, `000011_*.up.sql:6-30`).
- Auth: `authorizeApi` does `getKeyByHash(hashApiKeySecret(candidate))` — O(1)
  unique-index lookup (`server-auth.ts:114`).
- Management routes are bootstrap-only (`API_AUTH_TOKEN`), never accept
  persisted keys (`server-auth.ts:16-18`).
- UI: Reveal/Copy are disabled affordances for existing rows
  (`(app)/api-keys/page.tsx:221-234`); only the generate flow reveals once
  (`RevealKeyModal.tsx`).
- No encryption utilities, no logger, and no rate limiter exist anywhere in
  `lib/api` — audit logging and the reveal rate limit are net-new, kept minimal.

## Design decisions

1. **Keep `key_hash` for auth.** SHA-256 of a 256-bit CSPRNG secret is not
   bruteforceable, so it is safe as a lookup index. Encryption is *additive*
   (enables reveal), not a replacement for the hash. Dropping the hash would
   force an O(n) decrypt-and-compare scan on every authenticated request.
   (Oracle confirmed: no materially better design; HMAC pepper is optional
   hardening, tracked below as a documented gap.)
2. **Add nullable `key_ciphertext` column** (migration `000012`). New keys store
   both hash and ciphertext. Existing rows keep `NULL` — their plaintext was
   never persisted, so they remain unrecoverable (the old contract stands;
   reveal returns 410 for them). No forced backfill.
3. **AES-256-GCM, key-ring, key-id envelope.** Key = 32 bytes from env
   `API_KEY_ENCRYPTION_KEY` (base64), with optional
   `API_KEY_ENCRYPTION_KEY_PREVIOUS` for rotation. Ciphertext envelope:
   `v1.<keyId>.<b64-iv>.<b64-tag>.<b64-ciphertext>` where `keyId` = first 8 hex
   chars of `SHA-256(key)`. Decrypt matches the envelope `keyId` against the
   configured ring (current, then previous); encrypt always uses the current
   key. This makes key rotation **zero-downtime** (previous key stays readable
   until re-encrypted). Strict parsing: exactly 5 dot-separated parts, IV
   exactly 12 bytes, tag exactly 16 bytes; decode and fail closed on any
   malformed input. AEAD auth tag makes tampered/wrong-key ciphertexts fail
   loudly (`KeySecretDecryptionError`, never swallowed).
4. **Reveal endpoint:** `GET /api/v1/api-keys/[serial]/secret` → `{ secret }`.
   Bootstrap-only (management routes never accept persisted keys),
   `requiredScope: "write"`. Errors: absent → 404; ciphertext `NULL` → 410
   ("secret not recoverable"); **revoked → 409** ("API key is revoked");
   decryption/config failure → 500 (generic, no internals leaked). Basic
   in-memory rate limit on this route only (no limiter exists repo-wide; keep it
   local and simple). Successful reveals emit a structured audit log line
   (serial, timestamp; the bootstrap identity is shared by definition).
5. **Fail-fast, scoped:** `createKey`/`revealKey` throw when
   `API_KEY_ENCRYPTION_KEY` is unset. Config errors surface at the api-keys
   feature level only, not on unrelated routes (sessions/webhooks keep working).
   Log config-missing as a server fault at startup, not a per-request error.
6. **Reveal gated server-side, not just in the UI:** `revealKey` returns a
   clear error for `revoked` keys (409). UI additionally keeps Reveal/Copy
   disabled on revoked rows. Reveal on expired-but-active keys is allowed.
7. **Audit logging.** Reveal of a live secret is the highest-value event to
   record. Minimal structured audit line on successful reveal (and on
   not-recoverable attempts); hooks into a real logger if the repo adopts one
   later. Response-shape tests assert error branches never serialize the
   secret, the envelope, or internal crypto error text.
8. **NULL-ciphertext alarm.** Startup (memoized in the composition root) counts
   rows with `key_ciphertext IS NULL AND created_at > <migration apply time>`
   and logs an alarm if any exist — catches a misconfigured deploy where the
   env key was unset at create time. Integration test asserts create always
   yields ciphertext.

## File map

| File | Change |
|------|--------|
| `shared/db/migrations/000012_add_api_key_ciphertext.up.sql` / `.down.sql` | **new** — `add column if not exists key_ciphertext text`; down drops it |
| `shared/db/schema.ts:266-299` | add `keyCiphertext: text("key_ciphertext")` to `apiKeys` |
| `apps/dashboard/src/lib/api/domain/api-key.ts` | `ApiKey.keyCiphertext: string \| null` |
| `apps/dashboard/src/lib/api/domain/errors.ts` | **new** `KeySecretNotRecoverableError`, `KeySecretDecryptionError`, `ApiKeyRevokedError` |
| `apps/dashboard/src/lib/api/ports/api-key-transport.ts:23-28` | `CreateApiKeyInput` gains `keyCiphertext: string` |
| `apps/dashboard/src/lib/api/security/api-key-cipher.ts` | **new** — `encryptApiKeySecret` / `decryptApiKeySecret` / key-ring parser (AES-256-GCM, keyId envelope, strict IV/tag validation) |
| `apps/dashboard/src/lib/api/service/api-key-management.ts` | `createKey` also persists ciphertext; new `revealKey(serial)`; constructor takes `encryptionKey` ring; reveal rejects revoked keys |
| `apps/dashboard/src/lib/api/adapters/db/index.ts:502-519, 619+` | `createKey` writes ciphertext; `mapApiKey` includes it; startup NULL-ciphertext count query |
| `apps/dashboard/src/lib/api/config.ts` | `apiKeyEncryptionKey`, `apiKeyEncryptionKeyPrevious` |
| `apps/dashboard/src/app/api/v1/api-keys/[serial]/secret/route.ts` | **new** — GET reveal endpoint (bootstrap-only, rate-limited, audit-logged) |
| `apps/dashboard/src/lib/api/api-keys.ts` | **new** `revealApiKeySecret(serial)` |
| `apps/dashboard/src/lib/api/types.ts` | **new** `ApiKeySecretResponse` |
| `apps/dashboard/src/lib/hooks/useApiKeys.ts` | **new** `reveal(serial): Promise<string>` |
| `apps/dashboard/src/app/(app)/api-keys/page.tsx:212-242` | enable Reveal/Copy for active keys, wire to reveal fetch |
| `apps/dashboard/src/app/(app)/api-keys/components/RevealKeyModal.tsx` | parameterize title/warning copy: "Key Generated" vs "Reveal key" (design lane) |
| `.env.example`, `docker-compose.yml` (dashboard env block) | add `API_KEY_ENCRYPTION_KEY`, `API_KEY_ENCRYPTION_KEY_PREVIOUS` |
| `docs/shared/README.md`, `docs/services/api/configuration.md`, `docs/services/worker/README.md:18-19` | migration table row + env rows + api-keys feature note |

## Milestones

### M0 — Encryption primitives + config
- `lib/api/security/api-key-cipher.ts`: AES-256-GCM with key-ring support
  (current + previous), `v1.<keyId>.<iv>.<tag>.<ct>` envelope, strict parser.
- `config.ts` + `.env.example` + `docker-compose.yml` + configuration docs.
- Unit tests: round-trip, rotation (encrypt with current, decrypt after moving
  it to previous), tamper, wrong key, malformed input (wrong part count,
  wrong IV/tag length, empty segments, bad key format, unknown keyId).

### M1 — Storage: migration, schema, adapter
- Migration `000012` (up/down); per `shared/AGENTS.md` rebuild migrate image:
  `docker compose build migrate && docker compose up -d migrate postgres`.
- Drizzle schema, domain type, port input, Drizzle adapter (`createKey` +
  `mapApiKey`).
- Startup NULL-ciphertext alarm (memoized count query in composition root).
- `RedactedApiKey` unchanged — ciphertext never leaves the service layer.

### M2 — Service: create-with-ciphertext + `revealKey`
- `createKey` encrypts before persisting; new errors in `domain/errors.ts`.
- `revealKey(serial)` → `{ secret }`; `null` when absent;
  `ApiKeyRevokedError` for revoked; `KeySecretNotRecoverableError` when
  ciphertext is `NULL`; `KeySecretDecryptionError` on auth failure.
  Config-missing → clear error.
- Service unit tests: create→reveal round-trip equals original secret, absent
  key, null ciphertext, decrypt failure, empty encryption key, revoked key.

### M3 — Reveal endpoint
- `GET /api/v1/api-keys/[serial]/secret` route (bootstrap-only, scope `write`,
  local in-memory rate limit, audit log on reveal).
- Route unit tests (mock compose/loadConfig): 401 (missing/wrong token), 404,
  409 (revoked), 410, 200 `{ secret }`, 500 on decrypt failure; response-shape
  tests assert only `{ secret }` is returned and error branches leak nothing
  (no secret, no envelope, no internal crypto text). Add route to the
  empty-token closure matrix in `app/api/v1/route-auth.test.ts`.
- Integration test (`route.integration.test.ts`): create via API → reveal
  returns the exact secret; a row inserted directly with `key_ciphertext NULL`
  → 410; a revoked row → 409; audit line emitted on successful reveal.

### M4 — Frontend: enable Reveal/Copy
- Client fn + hook `reveal`; page wires Reveal → fetch → `RevealKeyModal`
  (reused), Copy → fetch → clipboard. Loading + error states.
- `RevealKeyModal` gains a mode prop (freshly generated vs on-demand) so the
  "won't be shown again" copy is not wrong for on-demand reveals.
- **Designer lane** for modal copy/visual adjustments; orchestrator reviews
  user-facing copy without flattening the design.
- Hook + page test updates: reveal flow, error banner, disabled revoked rows,
  and a secret-lifetime assertion (plaintext not present in the DOM after the
  reveal modal closes).

### M5 — Docs + full verification
- Docs rows/tables per file map; rotation runbook (set previous → verify reveals
  still work → re-encrypt/re-issue or rotate → drop previous) in
  `docs/services/api/configuration.md`; note documented gaps (multi-tenant
  ownership scoping, optional `API_KEY_HASH_PEPPER`).

## Verification

```bash
# From apps/dashboard (or repo root via turbo):
npm test
npm run lint
npm run build

# Migration apply (per shared/AGENTS.md):
docker compose build migrate
docker compose up -d migrate postgres
# check status via the migrate service or worker migrate CLI

# Dashboard integration suite (per docs/services/api/testing.md):
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/waba_test?sslmode=disable \
  npm test -- --runInBand    # integration-gated tests incl. api-keys
```

Manual smoke: generate a key → close reveal → use row Reveal/Copy → key shows
again; verify old (pre-migration) key returns 410; revoked key returns 409;
wrong `API_KEY_ENCRYPTION_KEY` yields a clean 500 with no internals leaked;
rotation drill: add previous key → reveals still succeed.

## Security notes

- Plaintext exists in memory only during create/reveal; never stored, logged,
  or recoverable from the DB by an attacker who steals the table but not the
  key. The hash alone is useless for secret recovery (256-bit CSPRNG input).
- `key_hash` retained for O(1) auth — this is what makes the refactor additive
  rather than a rewrite of the auth path.
- Key rotation is zero-downtime via the key-id ring; re-encryption of existing
  rows is out of scope (a runbook covers the rotation path).
- Reveal is bootstrap-only like the rest of management; persisted keys can
  never call it. Revoked keys are blocked server-side (409), not just in the UI.
- Audit log covers reveals; response-shape tests guard against accidental
  serialization of the secret, envelope, or internal error text.
- Known gaps (documented, out of scope): `api_keys` has no owner/`created_by`
  — if multi-tenant lands, reveal needs ownership scoping; optional
  `API_KEY_HASH_PEPPER` (HMAC) to independentize the auth hash from a plain
  SHA-256; DB-backed audit rows (currently minimal structured logs).

## Verification Log

| Date | Command | Result |
| ---- | ------- | ------ |
