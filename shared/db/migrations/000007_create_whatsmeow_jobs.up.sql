create table if not exists public.whatsmeow_jobs (
    id                bigserial primary key,
    serial            uuid not null default gen_random_uuid(),
    source_job_serial uuid,                       -- references jobs.serial (no FK; jobs row may be GC'd independently)
    type              text not null default 'send_message',
    phone_number_id   text not null,
    payload           jsonb not null,
    status            text not null default 'pending'
                      check (status in ('pending', 'claimed', 'succeeded', 'failed')),
    attempts          int  not null default 0,
    max_attempts      int  not null default 3,
    available_at      timestamptz not null default now(),
    claimed_by        text,
    claimed_at        timestamptz,
    completed_at      timestamptz,
    last_error        text,
    result            jsonb,
    idempotency_key   text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    deleted_at        timestamptz
);

create unique index if not exists whatsmeow_jobs_serial_idx
    on public.whatsmeow_jobs (serial);
create unique index if not exists whatsmeow_jobs_idempotency_key_idx
    on public.whatsmeow_jobs (idempotency_key) where idempotency_key is not null;
create index if not exists whatsmeow_jobs_claim_idx
    on public.whatsmeow_jobs (status, available_at, created_at);
create index if not exists whatsmeow_jobs_source_idx
    on public.whatsmeow_jobs (source_job_serial) where source_job_serial is not null;

-- set_updated_at() is owned by 000001_create_jobs; only the trigger is created
-- here.
create trigger whatsmeow_jobs_set_updated_at
    before update on public.whatsmeow_jobs
    for each row execute function public.set_updated_at();
