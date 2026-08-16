import type { ActivityInsertRow } from "../ports/activity-transport";

export interface BuildApiRequestRowArgs {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  requestSerial: string | null;
  jobSerial: string | null;
  phoneNumberId: string | null;
  businessAccountId: string;
  requestBody: unknown | null;
  responseBody: unknown | null;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  error?: string;
}

/**
 * Pure row builder for an `api_request` activity row. No Next.js imports —
 * fully unit-testable. Bodies/headers arrive already read/redacted.
 */
export function buildApiRequestRow(args: BuildApiRequestRowArgs): ActivityInsertRow {
  const {
    method,
    path,
    status,
    durationMs,
    requestSerial,
    jobSerial,
    phoneNumberId,
    businessAccountId,
    requestBody,
    responseBody,
    requestHeaders,
    responseHeaders,
    error,
  } = args;

  return {
    type: "api_request",
    status: error !== undefined ? "error" : "ok",
    summary: `${method} ${path} → ${status}${error !== undefined ? " (error)" : ""}`,
    requestSerial,
    jobSerial,
    phoneNumberId,
    businessAccountId,
    payload: {
      method,
      path,
      status,
      duration_ms: durationMs,
      error,
      request:
        requestBody === null
          ? undefined
          : { headers: requestHeaders, body: requestBody },
      response:
        responseBody === null
          ? undefined
          : { headers: responseHeaders, body: responseBody },
    },
  };
}