import type { NextRequest, NextResponse } from "next/server";
import type { ActivityContext } from "./domain/observability";

/**
 * Route middleware context threaded through the nested composition chain
 * `authz(time(obs(handler)))`.
 *
 * - `params` is the route's dynamic params (Next passes a `Promise`); routes
 *   `await params`. Kept `any` so the captured handler behaves exactly like the
 *   unwrapped route handler it replaced (do not over-type it).
 * - `identity` / `requestSerial` are set by `authz` to the authenticated
 *   principal — the api-key serial, the literal `"bootstrap"`, or null. The row
 *   stores `requestSerial` (alias of `identity`).
 * - `activity` is created by `obs` so wrapped handlers can report an enqueued
 *   `job_serial` via `setJobSerial`.
 * - `timing` is exposed by `time()` and consumed by `obs` for `duration_ms`.
 */
export interface RouteContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: any;
  identity: string | null;
  requestSerial: string | null;
  activity: ActivityContext;
  timing?: { elapsed(): number };
}

/** A wrapped route handler. The `ctx` is fully populated by the chain. */
export type RouteHandler = (
  req: NextRequest,
  ctx: RouteContext,
) => Promise<NextResponse>;

/** A middleware factory: `(handler) => handler`. */
export type ApiMiddleware = (handler: RouteHandler) => RouteHandler;

/**
 * Signature of the outermost composed function — the one Next.js calls. It
 * only ever receives Next's `{ params }` context (or nothing); `authz` builds
 * the full `RouteContext` for the inner chain. `params` stays `any` so the
 * shape is assignable to Next's generated RouteHandlerConfig validator.
 */
export type NextRouteHandler = (
  req: NextRequest,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx?: { params?: any },
) => Promise<NextResponse>;