create table if not exists public.jobs (
    id              uuid primary key default gen_random_uuid(),
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
    idempotency_key text unique,
    created_at      timestamptz not null default now()
);

create index if not exists jobs_claim_idx
    on public.jobs (status, available_at, created_at);
