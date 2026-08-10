/**
 * Authorization helpers for Next.js Route Handlers (server-side).
 */

import { NextRequest } from "next/server";

export function authorizeBearer(req: NextRequest, token: string): boolean {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  return auth.slice(7) === token;
}

export function authorizeInternal(req: NextRequest): boolean {
  const token = process.env.INTERNAL_TOKEN ?? "";
  if (token === "") return false;
  return authorizeBearer(req, token);
}
