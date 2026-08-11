-- Reverse 000009: drop the partial unique index and restore the full unique
-- constraint on phone_number_id. The constraint is re-added only if it is not
-- already present, so re-running this down migration is safe.
drop index if exists sessions_phone_number_id_active_idx;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'sessions_phone_number_id_key'
          and conrelid = 'public.sessions'::regclass
          and contype = 'u'
    ) then
        alter table public.sessions
            add constraint sessions_phone_number_id_key unique (phone_number_id);
    end if;
end $$;
