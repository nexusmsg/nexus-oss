-- Developer dashboard activity log (observability).
--
-- Migration 000013 (000006 remains an intentional gap in the migration
-- sequence; do not "fill" it).
--
-- One generic append-only log of important activities (API requests, inbound
-- WhatsApp events, webhook deliveries). A single table with a `type`
-- discriminator plus a `jsonb` detail payload matches the existing `jobs` /
-- `whatsmeow_jobs` jsonb conventions and gives a uniform Stripe-like timeline.
--
-- Correlation columns follow the existing no-FK `source_job_serial` pattern:
-- uuid links point at serials in other tables with no referential constraint.
create table if not exists public.activity_events (
  id                  bigint generated always as identity primary key,
  serial              uuid not null default gen_random_uuid(),
  type                text not null
                      check (type in ('api_request', 'whatsapp_event', 'webhook_delivery')),
  status              text not null
                      check (status in ('ok', 'error', 'attempted')),
  phone_number_id     text,                       -- tenant/device key (no FK)
  business_account_id text not null default '',   -- parity with sessions
  summary             text not null default '',   -- short human line for rows
  -- correlation columns (all nullable; uuid links follow the no-FK pattern)
  job_serial            uuid,                     -- API request -> jobs/whatsmeow_jobs
  wa_message_id         text,                     -- wamid: outbound result <-> inbound event
  source_activity_serial uuid,                    -- webhook_delivery -> whatsapp_event
  resource_type         text,                     -- 'session' | 'webhook_config' | 'api_key' | 'job'
  resource_serial       uuid,                     -- serial of the related resource when it exists
  request_serial        text,                     -- api_key serial OR the literal 'bootstrap' (NOT a uuid)
  payload             jsonb,                      -- kind-specific detail
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists activity_events_list_idx
    on public.activity_events (created_at desc, type);
create index if not exists activity_events_phone_idx
    on public.activity_events (phone_number_id);
create index if not exists activity_events_job_serial_idx
    on public.activity_events (job_serial) where job_serial is not null;
create index if not exists activity_events_wamid_idx
    on public.activity_events (wa_message_id) where wa_message_id is not null;
create index if not exists activity_events_source_idx
    on public.activity_events (source_activity_serial) where source_activity_serial is not null;
create index if not exists activity_events_resource_idx
    on public.activity_events (resource_serial) where resource_serial is not null;

-- set_updated_at() is owned by 000001_create_jobs; only the trigger is created
-- here (repo convention: every timestamped table keeps its mirror updated).
create trigger activity_events_set_updated_at
    before update on public.activity_events
    for each row execute function public.set_updated_at();
