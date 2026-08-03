create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end $$;

create table if not exists public.jobs (
    id              bigserial primary key,
    serial          uuid not null default gen_random_uuid(),
    type            text not null default 'send_message',
    phone_number_id text not null,
    payload         jsonb not null,
    status          text not null default 'pending'
                    check (status in ('pending', 'claimed', 'succeeded', 'failed')),
    attempts        int  not null default 0,
    max_attempts    int  not null default 3,
    available_at    timestamptz not null default now(),
    claimed_by      text,
    claimed_at      timestamptz,
    completed_at    timestamptz,
    last_error      text,
    result          jsonb,
    idempotency_key text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    deleted_at      timestamptz
);

create unique index if not exists jobs_serial_idx
    on public.jobs (serial);
create unique index if not exists jobs_idempotency_key_idx
    on public.jobs (idempotency_key) where idempotency_key is not null;
create index if not exists jobs_claim_idx
    on public.jobs (status, available_at, created_at);

create trigger jobs_set_updated_at
    before update on public.jobs
    for each row execute function public.set_updated_at();
