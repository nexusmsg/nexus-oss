import type { NextRequest, NextResponse } from "next/server";

/**
 * Safely read a JSON body from a `NextRequest` without consuming the live
 * stream the handler still needs. `req.clone()` is the documented safe pattern;
 * only the clone is consumed. A non-JSON body yields a best-effort attempt;
 * parse or clone failures resolve to `null` so capture never breaks the
 * request.
 */
export async function readBodySafe(req: NextRequest): Promise<unknown> {
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
 * UTF-8) back into a clone so reading never consumes the original stream the
 * caller still needs to return. Parse failures resolve to the raw text; read
 * failures resolve to null.
 */
export async function readResponseBodySafe(res: NextResponse): Promise<unknown> {
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