-- Allow reusing a phone_number_id once the webhook config that used it is
-- deleted: drop the full unique constraint (webhook_configs_phone_number_id_key,
-- created by 000002's `phone_number_id ... unique`) and enforce uniqueness only
-- among active configs (deleted_at is null). Soft-deleted configs no longer
-- block a phone number from being registered again.
alter table public.webhook_configs
    drop constraint if exists webhook_configs_phone_number_id_key;

create unique index if not exists webhook_configs_phone_number_id_active_idx
    on public.webhook_configs (phone_number_id)
    where deleted_at is null;
