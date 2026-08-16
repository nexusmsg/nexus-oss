/** Secret headers masked in the captured request/response header records. */
const REDACTED_HEADERS = new Set([
  "authorization",
  "cookie",
  "x-api-key",
  "x-forwarded-authorization",
]);

/** Redact secret headers from a request/response header record. */
export function redactHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = REDACTED_HEADERS.has(key.toLowerCase()) ? "<redacted>" : value;
  });
  return out;
}