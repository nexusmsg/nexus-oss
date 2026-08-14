/**
 * API-request capture wrapper (plan §4, §10 R1/R4/R7).
 *
 * `withApiActivity` wraps the existing per-route `authorizeApiWithIdentity` +
 * handler call. It records one `api_request` activity row per public request
 * (method, path, status, duration_ms, full request/response bodies, and the
 * authenticated identity / `request_serial`). Routes that enqueue a job report
 * its serial via the `ActivityContext` passed into the handler.
 *
 * Fire-and-forget discipline (R4, mirroring `touchLastUsedBestEffort`): the
 * `NextResponse` is built first, then the record is fired with
 * `void service.record(...).catch(log)` — never awaited, always caught. A
 * recorder failure must never change the route's response; an exception is
 * swallowed (and logged). On a handler throw, an `error` row is recorded
 * (status 500) before the error is rethrown per the existing route convention.
 */

import { NextRequest, NextResponse } from "next/server";
import { composeServices } from "./compose";
import { loadConfig, type Config } from "./config";
import type { AuthorizeApiOptions } from "./server-auth";
import { authorizeApiWithIdentity } from "./server-auth";
import type { ActivityContext } from "./domain/observability";
import type { ObservabilityServicePort } from "./service/observability";

/** A wrapped route handler. Receives the request, its parsed params, and the
 *  activity context (to report an enqueued `job_serial`). */
export type ApiActivityHandler<Params> = (
  req: NextRequest,
  ctx: { params: Params; activity: ActivityContext },
) => Promise<NextResponse>;

/** Options for `withApiActivity`. */
export interface WithApiActivityOptions<Params> {
  /** The wrapped handler. */
  handler: ApiActivityHandler<Params>;
  /** The scope the route demands from a persisted API key (or "read"). */
  requiredScope: AuthorizeApiOptions["requiredScope"];
  /**
   * When true, only the bootstrap `API_AUTH_TOKEN` is accepted. Persisted
   * keys never authorize and no hash lookup is attempted. Required for
   * management routes (`/api/v1/api-keys/**`). Defaults to false: public
   * routes accept persisted keys via `composeServices(config).apiKeyAuth`.
   */
  bootstrapOnly?: boolean;
  /**
   * Optional lazy accessor for the persisted-key auth port. Public routes
   * default to `() => composeServices(config).apiKeyAuth`; management routes
   * set `bootstrapOnly` instead of omitting this.
   */
  getPersistedKeys?: AuthorizeApiOptions["getPersistedKeys"];
  /**
   * Builds the `ObservabilityServicePort` from the loaded config, so the
   * wrapper does not couple to the composition root's shape. Defaults to
   * `() => composeServices(config).observability`.
   */
  getObservability?: (config: Config) => ObservabilityServicePort;
  /**
   * Resolves the request path used in the recorded payload (so wrapped routes
   * can report their logical path, e.g. `/api/waba/.../messages`). Defaults to
   * `req.nextUrl.pathname`.
   */
  resolvePath?: (req: NextRequest) => string;
  /**
   * Logger for recorder failures (never the request's own console.error that
   * would mask a real error). Defaults to `console.error`.
   */
  log?: (err: unknown) => void;
  /**
   * When false, the response body is NOT captured — use for routes that return
   * a secret (e.g. API-key reveal) so tokens never land in the activity log.
   * The request body is still captured (and redacted). Defaults to true.
   */
  captureResponse?: boolean;
}

/**
 * Identity helper: `authorizeApiWithIdentity` resolves a principal into
 * `request_serial` — the api key serial, the literal `"bootstrap"`, or null
 * for unauthenticated calls. The wrapper keeps this mapping in one place.
 */
function toRequestSerial(identity: string | null): string | null {
  return identity;
}

/** Redact secret headers from a request/response header record. */
function redactHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (
      lower === "authorization" ||
      lower === "cookie" ||
      lower === "x-api-key" ||
      lower === "x-forwarded-authorization"
    ) {
      out[key] = "<redacted>";
      return;
    }
    out[key] = value;
  });
  return out;
}

/**
 * Safely read a JSON body from a NextRequest without consuming the live stream
 * the handler still needs. `req.clone()` is the documented safe pattern; only
 * the clone is consumed. A non-JSON body yields a best-effort attempt; parse or
 * clone failures resolve to `null` so capture never breaks the request.
 */
async function readBodySafe(req: NextRequest): Promise<unknown> {
  try {
    const cloned = req.clone();
    const text = await cloned.text();
    if (text === "") return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch {
    return null;
  }
}

/**
 * Safely read a JSON body from a `NextResponse`. Wraps the body text (currently
 * UTF-8) back into a `Response` clone so reading never consumes the original
 * stream the caller still needs to return. Parse failures resolve to the raw
 * text; read failures resolve to null.
 */
async function readResponseBodySafe(res: NextResponse): Promise<unknown> {
  try {
    const cloned = res.clone();
    const text = await cloned.text();
    if (text === "") return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch {
    return null;
  }
}

function makeActivityContext(): ActivityContext {
  let reported: string | null = null;
  return {
    setJobSerial(serial: string): void {
      reported = serial;
    },
    get jobSerial(): string | null {
      return reported;
    },
  };
}

/**
 * Wrap a public route handler with API-request activity capture. The returned
 * function has the same `(req, params)` signature as a Next.js route handler,
 * so callers replace `export async function GET(req)` with
 * `export const GET = withApiActivity({ handler: async (req, ctx) => { ... } })`.
 *
 * `config` and `apiAuthToken` are sourced inside the wrapper from `loadConfig`
 * so the wrapped handler signature stays identical to an unwrapped one.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withApiActivity<Params = any>(
  options: WithApiActivityOptions<Params>,
): (req: NextRequest, ctx: { params: Params }) => Promise<NextResponse> {
  const {
    handler,
    requiredScope,
    bootstrapOnly = false,
    getPersistedKeys,
    getObservability,
    resolvePath,
    captureResponse = true,
    log = (err: unknown) =>
      console.error("[observability-capture] record failed:", err),
  } = options;

  return async (req: NextRequest, ctx?: { params: Params }): Promise<NextResponse> => {
    const config = loadConfig();
    const start = Date.now();
    const params = ctx?.params as Params;

    const auth = await authorizeApiWithIdentity(req, config.apiAuthToken, {
      requiredScope,
      getPersistedKeys: bootstrapOnly
        ? undefined
        : (getPersistedKeys ?? (() => composeServices(config).apiKeyAuth)),
    });

    if (!auth.authorized) {
      // Auth rejections are a security concern, not API activity to correlate
      // with worker ops, so we return the envelope without composing services
      // or recording a row (R4 keeps the rejection path dependency-free).
      return NextResponse.json(
        { error: { message: "Invalid OAuth access token", type: "OAuthException", code: 401 } },
        { status: 401 },
      );
    }

    const activity = makeActivityContext();
    try {
      const res = await handler(req, { params, activity });

      const requestSerial = toRequestSerial(auth.identity);
      const jobSerial = activity.jobSerial;
      void recordRequest({
        req,
        res,
        config,
        getObservability,
        resolvePath,
        captureResponse,
        log,
        start,
        requestSerial,
        jobSerial,
      });
      return res;
    } catch (err) {
      // Record an error row (status 500) for the failed request, then rethrow
      // per the existing route convention (the framework turns it into a 500).
      const errorRes = NextResponse.json(
        { error: { message: "Internal server error", type: "OAuthException", code: 500 } },
        { status: 500 },
      );
      void recordRequest({
        req,
        res: errorRes,
        config,
        getObservability,
        resolvePath,
        captureResponse,
        log,
        start,
        requestSerial: toRequestSerial(auth.identity),
        jobSerial: activity.jobSerial,
        error: summarizeError(err),
      });
      throw err;
    }
  };
}

function summarizeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message.length > 500 ? `${err.message.slice(0, 500)}…` : err.message;
  }
  try {
    return JSON.stringify(err).slice(0, 500);
  } catch {
    return "unknown error";
  }
}

interface RecordArgs {
  req: NextRequest;
  res: NextResponse;
  config: Config;
  getObservability?: (config: Config) => ObservabilityServicePort;
  resolvePath?: (req: NextRequest) => string;
  captureResponse: boolean;
  log: (err: unknown) => void;
  start: number;
  requestSerial: string | null;
  jobSerial: string | null;
  error?: string;
}

/**
 * Fire-and-forget record (R4). Builds the row from the final response, then
 * `void service.record(...).catch(log)`. Never awaited; a failure is logged and
 * swallowed so it cannot alter the response already built.
 */
async function recordRequest(args: RecordArgs): Promise<void> {
  const {
    req,
    res,
    config,
    getObservability,
    resolvePath,
    captureResponse,
    log,
    start,
    requestSerial,
    jobSerial,
    error,
  } = args;

  const status = res.status;
  const durationMs = Date.now() - start;
  const method = req.method;
  const path = resolvePath ? resolvePath(req) : req.nextUrl.pathname;

  const [requestBody, responseBody] = await Promise.all([
    readBodySafe(req),
    captureResponse ? readResponseBodySafe(res) : Promise.resolve(null),
  ]);

  const row = {
    type: "api_request" as const,
    status: error !== undefined ? ("error" as const) : ("ok" as const),
    summary: `${method} ${path} → ${status}${error !== undefined ? " (error)" : ""}`,
    requestSerial,
    jobSerial,
    phoneNumberId: null,
    businessAccountId: "",
    payload: {
      method,
      path,
      status,
      duration_ms: durationMs,
      error,
      request:
        requestBody === null
          ? undefined
          : {
              headers: redactHeaders(req.headers),
              body: requestBody,
            },
      response:
        responseBody === null
          ? undefined
          : {
              headers: redactHeaders(res.headers),
              body: responseBody,
            },
    },
  };

    try {
      const observability = getObservability
        ? getObservability(config)
        : composeServices(config).observability;
      void observability.record(row).catch(log);
    } catch (recErr) {
      // Composition or record setup failure: log and swallow; never throw back
      // into the response path.
      log(recErr);
    }
}
