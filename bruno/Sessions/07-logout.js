// Capture the logout job's serial for observability; logout does not need a
// follow-up GET scoped by job serial.
const body = res.getBody();
if (body && body.job_serial) {
  bru.setVar("logout_job_serial", body.job_serial);
}