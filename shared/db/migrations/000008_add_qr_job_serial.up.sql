-- Link each QR row back to the pairing job that produced it, so the API can
-- fetch the QR for a specific job_serial and avoid returning a stale QR from
-- an earlier pairing attempt on the same session.
alter table public.session_qr_codes
    add column if not exists job_serial uuid;

create index if not exists session_qr_codes_job_serial_idx
    on public.session_qr_codes (job_serial)
    where job_serial is not null;