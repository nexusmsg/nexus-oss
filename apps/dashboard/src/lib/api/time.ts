import type { ApiMiddleware } from "./handler";

/**
 * Middleware that exposes an elapsed-time timer on the context. `obs` consumes
 * it (`ctx.timing?.elapsed()`) for the recorded `duration_ms`; fallback is
 * `Date.now() - start` inside `record`.
 */
export function time(): ApiMiddleware {
  return (handler) => async (req, ctx) => {
    // authz starts the timer before authentication so recorded durations retain
    // the old wrapper's behavior. Preserve that timer through this layer.
    if (ctx.timing === undefined) {
      const start = Date.now();
      ctx.timing = { elapsed: () => Date.now() - start };
    }
    return handler(req, ctx);
  };
}
