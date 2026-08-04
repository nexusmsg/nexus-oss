drop table if exists public.webhook_subscriptions;

alter table public.webhook_configs
    drop column if exists enabled,
    drop column if exists max_retries,
    drop column if exists retry_delay_ms,
    drop column if exists timeout_ms;
