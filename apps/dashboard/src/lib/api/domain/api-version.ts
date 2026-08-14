/**
 * WABA API version constants and validation. Pure TS — no Next.js imports.
 *
 * The route path carries the API version (`/api/waba/:version/...`); only the
 * versions listed here are accepted. `v26.0` is the current default.
 */

export const DEFAULT_API_VERSION = "v26.0";

/** API versions this server can serve. Extend as new versions are supported. */
export const SUPPORTED_API_VERSIONS: readonly string[] = [DEFAULT_API_VERSION];

/** `v<major>.<minor>` — the official Graph API version format. */
const VERSION_PATTERN = /^v\d+\.\d+$/;

/**
 * Normalize and validate an API version path param. Returns the supported
 * version string, or `null` when the raw value is malformed or unsupported.
 */
export function parseApiVersion(raw: string): string | null {
  const version = raw.trim().toLowerCase();
  if (!VERSION_PATTERN.test(version)) return null;
  return SUPPORTED_API_VERSIONS.includes(version) ? version : null;
}
