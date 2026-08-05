-- Business account id per session: used as entry[].id in webhook payloads
-- (per-tenant). Empty means "use the worker's global BUSINESS_ACCOUNT_ID".
alter table public.sessions
    add column if not exists business_account_id text not null default '';