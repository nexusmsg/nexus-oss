-- Reverse 000012: drop the nullable ciphertext column added for on-demand
-- reveal. Idempotent so re-running this down migration is safe. `key_hash`
-- (auth) and all other columns are unaffected.
alter table public.api_keys drop column if exists key_ciphertext;
