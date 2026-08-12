-- Reverse 000011: drop the trigger (with its indexes) and the table. Both
-- statements are idempotent, so re-running this down migration is safe.
drop trigger if exists api_keys_set_updated_at on public.api_keys;
drop table if exists public.api_keys;
