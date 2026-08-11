drop index if exists session_qr_codes_job_serial_idx;
alter table public.session_qr_codes
    drop column if exists job_serial;