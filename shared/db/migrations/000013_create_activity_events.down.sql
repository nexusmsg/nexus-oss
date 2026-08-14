-- Reverse 000013: drop the trigger and the table. Both statements are
-- idempotent, so re-running this down migration is safe.
drop trigger if exists activity_events_set_updated_at on public.activity_events;
drop table if exists public.activity_events;
