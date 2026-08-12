-- API keys: global Bearer credentials for the dashboard API.
--
-- Migration 000011 (000006 is an existing intentional gap in the migration
-- sequence; do not "fill" it).
--
-- Each key stores a SHA-256 hex digest of the full secret (key_hash) plus a
-- non-secret display prefix (key_prefix). The plaintext secret is returned
-- exactly once at creation and is never persisted, logged, or recoverable.
-- `serial` is the primary key: keys are global (no tenant/owner identity yet)
-- and are always referenced by serial or hash, never by a numeric FK.
create table if not exists public.api_keys (
    serial       uuid primary key default gen_random_uuid(),
    name         text not null,
    key_prefix   text not null,
    key_hash     text not null,
    scope        text not null default 'read'
                 check (scope in ('read', 'write', 'full')),
    status       text not null default 'active'
                 check (status in ('active', 'revoked')),
    expires_at   timestamptz,           -- null = key never expires
    last_used_at timestamptz,           -- null = key never successfully used
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    deleted_at   timestamptz            -- soft delete; null = active
);

-- Hash lookup is the authorizer's primary path: unique so a leaked row cannot
-- be silently duplicated, and indexed for constant-time lookup by hash.
create unique index if not exists api_keys_key_hash_idx
    on public.api_keys (key_hash);

-- List/filter of live keys (management routes and the future dashboard) always
-- exclude soft-deleted rows.
create index if not exists api_keys_status_idx
    on public.api_keys (status)
    where deleted_at is null;

-- set_updated_at() is owned by 000001_create_jobs; only the trigger is created
-- here.
create trigger api_keys_set_updated_at
    before update on public.api_keys
    for each row execute function public.set_updated_at();
