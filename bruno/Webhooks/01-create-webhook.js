// Capture the created webhook config's serial for later requests.
const body = res.getBody();
if (body && body.serial) {
  bru.setVar("webhook_serial", body.serial);
}
