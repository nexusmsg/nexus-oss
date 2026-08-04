// Capture the created session's serial (returned as `id`) for later requests.
const body = res.getBody();
if (body && body.id) {
  bru.setVar("session_serial", body.id);
}
