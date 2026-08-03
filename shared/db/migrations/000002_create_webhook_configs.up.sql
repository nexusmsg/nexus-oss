create table if not exists public.webhook_configs (
    id              bigserial primary key,
    serial          uuid not null default gen_random_uuid(),
    phone_number_id text not null unique,
    webhook_url     text not null,
    webhook_secret  text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    deleted_at      timestamptz
);

create unique index if not exists webhook_configs_serial_idx
    on public.webhook_configs (serial);

create trigger webhook_configs_set_updated_at
    before update on public.webhook_configs
    for each row execute function public.set_updated_at();
