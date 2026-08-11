-- Allow reusing a phone_number_id once the session that used it is deleted:
-- drop the full unique constraint (sessions_phone_number_id_key, created by
-- 000003's `phone_number_id ... unique`) and enforce uniqueness only among
-- active sessions (deleted_at is null). Soft-deleted sessions no longer block
-- a phone number from being paired again.
alter table public.sessions
    drop constraint if exists sessions_phone_number_id_key;

create unique index if not exists sessions_phone_number_id_active_idx
    on public.sessions (phone_number_id)
    where deleted_at is null;
