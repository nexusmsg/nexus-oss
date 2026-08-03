create table if not exists public.webhook_configs (
    phone_number_id text primary key,
    webhook_url     text not null,
    webhook_secret  text,
    updated_at      timestamptz not null default now()
);
