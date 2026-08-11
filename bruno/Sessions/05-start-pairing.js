// Capture the pairing job's serial so the follow-up GET /pairing/qr can
// scope the read to THIS job (avoids stale-QR reads when several pairing
// jobs overlap on the same session).
const body = res.getBody();
if (body && body.job_serial) {
  bru.setVar("pairing_job_serial", body.job_serial);
}