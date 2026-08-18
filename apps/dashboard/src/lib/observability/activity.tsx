/* ── Observability UI helpers ──────────────────────────────
 * Shared presentation helpers for the Activity list and detail pages:
 * badge/label mappings, the resource cross-link route map, timestamp
 * formatting, and the `Property` row used by the detail view.
 * ─────────────────────────────────────────────────────────── */

import type { ReactNode } from "react";
import type { ActivityResourceType, ActivityStatus, ActivityType } from "@/lib/api/types";

/* ── Type/status badge labels ─────────────────────────────── */

export const TYPE_LABELS: Record<ActivityType, string> = {
  api_request: "API Request",
  whatsapp_event: "WhatsApp Event",
  webhook_delivery: "Webhook",
};

export const TYPE_BADGE: Record<ActivityType, "info" | "success" | "warning"> = {
  api_request: "info",
  whatsapp_event: "success",
  webhook_delivery: "warning",
};

export const STATUS_BADGE: Record<ActivityStatus, "success" | "danger" | "warning"> = {
  ok: "success",
  error: "danger",
  attempted: "warning",
};

/* AC-104: resource kind → existing list page route. Kinds without a
 * dedicated page fall back to monospace text. */
export const RESOURCE_ROUTE: Partial<Record<ActivityResourceType, string>> = {
  session: "/sessions",
  webhook_config: "/webhooks",
  api_key: "/api-keys",
};

/* ── Time formatting ──────────────────────────────────────── */

export function formatTime(
  iso: string,
  options?: { withYear?: boolean; withSeconds?: boolean },
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    year: options?.withYear === false ? undefined : "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: options?.withSeconds ? "2-digit" : undefined,
  });
}

/* ── Property row (detail view) ───────────────────────────── */

export function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-line-light py-3 first:border-t-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="font-mono text-sm text-right break-all">{children}</dd>
    </div>
  );
}
