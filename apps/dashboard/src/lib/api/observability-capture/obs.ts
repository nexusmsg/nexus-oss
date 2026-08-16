import { internalError } from "../envelopes";
import type { ApiMiddleware } from "../handler";
import { makeActivityContext } from "./context";
import { summarizeError } from "./errors";
import { record, type RecordOptions } from "./record";

export type ObsOptions = RecordOptions;

/**
 * Innermost middleware: creates the activity context (setJobSerial contract),
 * runs the handler, then fires the `api_request` row fire-and-forget. On a
 * handler throw, records an `error` row (500) before rethrowing per the
 * existing route convention.
 */
export function obs(options: ObsOptions = {}): ApiMiddleware {
  return (handler) => async (req, ctx) => {
    ctx.activity = makeActivityContext();
    const start = Date.now();
    try {
      const res = await handler(req, ctx);
      void record({ req, res, ctx, options, start });
      return res;
    } catch (err) {
      const errorRes = internalError();
      void record({ req, res: errorRes, ctx, options, start, error: summarizeError(err) });
      throw err;
    }
  };
}