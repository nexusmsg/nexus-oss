-- Extend webhook_configs with retry policy and enabled flag.
alter table public.webhook_configs
    add column if not exists enabled boolean not null default true,
    add column if not exists max_retries int not null default 3,
    add column if not exists retry_delay_ms int not null default 1000,
    add column if not exists timeout_ms int not null default 10000;

-- Webhook event subscriptions: which event types a webhook config receives.
create table if not exists public.webhook_subscriptions (
    id              bigserial primary key,
    serial          uuid not null default gen_random_uuid(),
    webhook_config_id bigint not null references public.webhook_configs(id) on delete cascade,
    event_type      text not null,
    created_at      timestamptz not null default now()
);

create unique index if not exists webhook_subscriptions_serial_idx
    on public.webhook_subscriptions (serial);

create unique index if not exists webhook_subscriptions_config_event_idx
    on public.webhook_subscriptions (webhook_config_id, event_type);

-- Seed default event subscriptions for existing webhook configs.
-- Only subscribe to 'messages' (inbound) by default.
insert into public.webhook_subscriptions (webhook_config_id, event_type)
select wc.id, 'messages'
from public.webhook_configs wc
where wc.deleted_at is null
  and not exists (
    select 1 from public.webhook_subscriptions ws
    where ws.webhook_config_id = wc.id and ws.event_type = 'messages'
  );
