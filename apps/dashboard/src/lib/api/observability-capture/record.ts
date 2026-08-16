import type { NextRequest, NextResponse } from "next/server";
import { composeServices } from "../compose";
import { loadConfig, type Config } from "../config";
import type { RouteContext } from "../handler";
import type { ObservabilityServicePort } from "../service/observability";
import { buildApiRequestRow } from "./build-row";
import { readBodySafe, readResponseBodySafe } from "./read-body";
import { redactHeaders } from "./redact";

export interface RecordOptions {
  /** Resolves the recorded path (e.g. `/api/waba/.../messages`). Default: `req.nextUrl.pathname`. */
  resolvePath?: (req: NextRequest) => string;
  /** When false, the response body is NOT captured (secret-bearing routes). Default: true. */
  captureResponse?: boolean;
  /** Lazy accessor for the observability service. Default: `composeServices(config).observability`. */
  getObservability?: (config: Config) => ObservabilityServicePort;
  /** Logger for recorder failures. Default: `console.error`. */
  log?: (err: unknown) => void;
}

export interface RecordArgs {
  req: NextRequest;
  res: NextResponse;
  ctx: RouteContext;
  options: RecordOptions;
  start: number;
  error?: string;
}

const defaultLog = (err: unknown): void =>
  console.error("[observability-capture] record failed:", err);

/**
 * Fire-and-forget record (R4). Reads bodies without consuming live streams,
 * redacts headers, builds the `api_request` row, and
 * `void observability.record(row).catch(log)`. Never awaited — a failure is
 * logged and swallowed so it cannot alter the response already built. The whole
 * body is guarded so composition or capture failures cannot reject the caller.
 */
export function record(args: RecordArgs): Promise<void> {
  return (async () => {
    const { req, res, ctx, options, start, error } = args;
    const config = loadConfig();
    const log = options.log ?? defaultLog;

    try {
      const status = res.status;
      const durationMs = ctx.timing?.elapsed() ?? Date.now() - start;
      const method = req.method;
      const path = options.resolvePath ? options.resolvePath(req) : req.nextUrl.pathname;
      const captureResponse = options.captureResponse ?? true;

      const [requestBody, responseBody] = await Promise.all([
        readBodySafe(req),
        captureResponse ? readResponseBodySafe(res) : Promise.resolve(null),
      ]);

      const row = buildApiRequestRow({
        method,
        path,
        status,
        durationMs,
        requestSerial: ctx.requestSerial,
        jobSerial: ctx.activity.jobSerial,
        phoneNumberId: null,
        businessAccountId: "",
        requestBody,
        responseBody,
        requestHeaders: redactHeaders(req.headers),
        responseHeaders: redactHeaders(res.headers),
        error,
      });

      const observability = options.getObservability
        ? options.getObservability(config)
        : composeServices(config).observability;
      void observability.record(row).catch(log);
    } catch (recErr) {
      // Capture or composition failure: log and swallow; never throw back into
      // the response path.
      log(recErr);
    }
  })();
}