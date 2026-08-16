import type { NextRequest, NextResponse } from "next/server";
import { composeServices } from "./compose";
import { loadConfig } from "./config";
import { unauthorized } from "./envelopes";
import type { NextRouteHandler, RouteHandler } from "./handler";
import { authorizeApiWithIdentity } from "./server-auth";

export interface AuthzOptions {
  /** The scope a persisted key must grant for this route. Bootstrap bypasses it. */
  scope: "read" | "write";
  /**
   * When true, only the bootstrap `API_AUTH_TOKEN` is accepted (management
   * routes). Persisted keys never authorize and no hash lookup is attempted.
   */
  bootstrapOnly?: boolean;
}

/**
 * Outermost middleware in the nested composition chain. Builds the
 * `RouteContext`, authorizes the request, and short-circuits to a WABA 401
 * envelope — WITHOUT invoking the inner chain or composing services — when the
 * credential is rejected (R4 keeps the rejection path dependency-free).
 */
export function authz(options: AuthzOptions): (handler: RouteHandler) => NextRouteHandler {
  return (handler) => async (
    req: NextRequest,
    routeCtx?: { params?: unknown },
  ): Promise<NextResponse> => {
    const config = loadConfig();
    const start = Date.now();
    const ctx = {
      params: routeCtx?.params,
      identity: null as string | null,
      requestSerial: null as string | null,
      timing: { elapsed: () => Date.now() - start },
      // Populated by the inner `obs` layer before it runs the handler.
      activity: undefined as never,
    };

    const auth = await authorizeApiWithIdentity(req, config.apiAuthToken, {
      requiredScope: options.scope,
      getPersistedKeys: options.bootstrapOnly
        ? undefined
        : () => composeServices(config).apiKeyAuth,
    });

    if (!auth.authorized) {
      return unauthorized();
    }

    ctx.identity = auth.identity;
    ctx.requestSerial = auth.identity;
    return handler(req, ctx);
  };
}
