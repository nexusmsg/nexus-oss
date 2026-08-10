/**
 * WABA-shaped error envelope helper. The API always responds to errors with
 * the Meta (Graph API) envelope shape:
 *   `{ error: { message, type: "OAuthException", code } }`.
 */

import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export const WABA_ERROR_TYPE = "OAuthException";

/** Invalid OAuth access token. */
export const WABA_CODE_INVALID_TOKEN = 190;
/** Invalid request / parameter. */
export const WABA_CODE_INVALID_PARAM = 100;
/** Internal API error. */
export const WABA_CODE_INTERNAL = 131000;

export function wabaError(
  c: Context,
  status: ContentfulStatusCode,
  code: number,
  message: string,
  headers?: Record<string, string>,
): Response {
  return c.json(
    {
      error: {
        message,
        type: WABA_ERROR_TYPE,
        code,
      },
    },
    status,
    headers,
  );
}
