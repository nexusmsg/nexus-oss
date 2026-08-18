/* ── ActivityLog ───────────────────────────────────────────
 * Observability activity list component.
 *
 * Uses the same shared table primitives as the API Keys page
 * (Card, TableWrap, Table, TableHead, TableRow, TableCell, Mono,
 * Badge, EmptyState) so both tables share identical styling.
 *
 * Standalone + NOT integrated yet: renders against dummy data
 * that matches the `ActivityEvent` API contract (see
 * `src/lib/api/types.ts`) and is driven entirely by props, so it
 * can be swapped to the real `useActivities` hook later without
 * markup changes.
 *
 * Conditions handled:
 *   - loading (list empty)  → 3-pulse skeleton rows   (AC-003)
 *   - error                 → error banner above table (AC-006)
 *   - empty data            → EmptyState               (AC-002)
 *   - data present          → table                    (AC-001)
 *   - type tabs             → client-side filter       (AC-004)
 *   - row click             → onNavigate(serial)       (AC-005)
 * ─────────────────────────────────────────────────────────── */

import { useMemo, useState } from "react";
import {
  Badge,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  Mono,
  Table,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableWrap,
} from "@/components";
import { IconActivity } from "@/components/icons";
import type { ActivityEvent, ActivityStatus, ActivityType } from "@/lib/api/types";
import { DUMMY_ACTIVITIES } from "@/app/(app)/observability/dummy-data";
import "./ActivityLog.css";

/* ── Type/status badge labels ─────────────────────────────── */

const TYPE_LABELS: Record<ActivityType, string> = {
  api_request: "API Request",
  whatsapp_event: "WhatsApp Event",
  webhook_delivery: "Webhook",
};

const TYPE_BADGE: Record<ActivityType, "info" | "success" | "warning"> = {
  api_request: "info",
  whatsapp_event: "success",
  webhook_delivery: "warning",
};

const STATUS_BADGE: Record<ActivityStatus, "success" | "danger" | "warning"> = {
  ok: "success",
  error: "danger",
  attempted: "warning",
};

type TabId = "all" | ActivityType;

const TABS: { id: TabId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "api_request", label: "API Request" },
  { id: "whatsapp_event", label: "WhatsApp Event" },
  { id: "webhook_delivery", label: "Webhook" },
];

const COLUMNS = ["Type", "Summary", "Phone", "Status", "Time"] as const;

/* ── Helpers ──────────────────────────────────────────────── */

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ── Component ────────────────────────────────────────────── */

export interface ActivityLogProps {
  /** Dummy data default; swap for the `useActivities` result later. */
  activities?: ActivityEvent[];
  /** When true and the list is empty, render 3 skeleton rows. */
  loading?: boolean;
  /** Non-null renders an error banner above the table. */
  error?: string | null;
  /** Row click handler — defaults to window navigation to the detail route. */
  onNavigate?: (serial: string) => void;
}

export function ActivityLog({
  activities = DUMMY_ACTIVITIES,
  loading = false,
  error = null,
  onNavigate,
}: ActivityLogProps) {
  const [activeTab, setActiveTab] = useState<TabId>("all");

  const visible = useMemo(
    () =>
      activeTab === "all"
        ? activities
        : activities.filter((a) => a.type === activeTab),
    [activities, activeTab],
  );

  const handleNavigate = (serial: string) => {
    if (onNavigate) {
      onNavigate(serial);
      return;
    }
    window.location.href = `/observability/${encodeURIComponent(serial)}`;
  };

  const countLabel = `${activities.length} event${activities.length === 1 ? "" : "s"}`;

  return (
    <>
      {/* List error banner (AC-006) */}
      {error && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-danger/20 bg-danger/8 px-4 py-3 text-sm text-danger">
          <span>{error}</span>
        </div>
      )}

      {/* Loading skeleton when empty (AC-003) */}
      {loading && activities.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <IconActivity size={16} /> Activity
            </CardTitle>
          </CardHeader>
          <TableWrap>
            <Table>
              <TableHead>
                <TableRow>
                  {COLUMNS.map((col) => (
                    <TableHeaderCell key={col}>{col}</TableHeaderCell>
                  ))}
                </TableRow>
              </TableHead>
              <tbody>
                {[0, 1, 2].map((i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <div className="h-4 w-20 animate-pulse rounded bg-elevated" />
                    </TableCell>
                    <TableCell>
                      <div className="h-4 w-56 animate-pulse rounded bg-elevated" />
                    </TableCell>
                    <Mono>
                      <div className="h-4 w-24 animate-pulse rounded bg-elevated" />
                    </Mono>
                    <TableCell>
                      <div className="h-4 w-14 animate-pulse rounded bg-elevated" />
                    </TableCell>
                    <Mono>
                      <div className="h-4 w-24 animate-pulse rounded bg-elevated" />
                    </Mono>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Card>
      )}

      {/* Empty state (AC-002) */}
      {!loading && !error && activities.length === 0 && (
        <EmptyState
          icon={<IconActivity size={28} />}
          title="No activity found"
          description="There is no activity to show yet. Events will appear here as they are recorded."
        />
      )}

      {/* Data table (AC-001) */}
      {!loading && activities.length > 0 && (
        <Card className="max-w-full">
          <CardHeader>
            <CardTitle>{countLabel}</CardTitle>
            {/* Type tabs filter (AC-004) */}
            <div
              className="activity-log__tabs"
              role="tablist"
              aria-label="Filter by type"
            >
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  className={
                    activeTab === tab.id
                      ? "activity-log__tab activity-log__tab--active"
                      : "activity-log__tab"
                  }
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </CardHeader>
          <TableWrap>
            <Table>
              <TableHead>
                <TableRow>
                  {COLUMNS.map((col) => (
                    <TableHeaderCell key={col}>{col}</TableHeaderCell>
                  ))}
                </TableRow>
              </TableHead>
              <tbody>
                {visible.map((a) => (
                  <TableRow
                    key={a.serial}
                    className="cursor-pointer"
                    onClick={() => handleNavigate(a.serial)}
                  >
                    <TableCell>
                      <Badge variant={TYPE_BADGE[a.type]}>{TYPE_LABELS[a.type]}</Badge>
                    </TableCell>
                    <TableCell className="max-w-80 truncate font-medium">
                      {a.summary}
                    </TableCell>
                    <Mono className="text-muted">
                      {a.phoneNumberId ?? "—"}
                    </Mono>
                    <TableCell>
                      <Badge variant={STATUS_BADGE[a.status]} dot>
                        {a.status}
                      </Badge>
                    </TableCell>
                    <Mono className="text-muted">{formatTime(a.createdAt)}</Mono>
                  </TableRow>
                ))}
                {visible.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={COLUMNS.length}
                      className="text-center text-muted"
                    >
                      No {TYPE_LABELS[activeTab as ActivityType].toLowerCase()} activity
                      recorded.
                    </TableCell>
                  </TableRow>
                )}
              </tbody>
            </Table>
          </TableWrap>
        </Card>
      )}
    </>
  );
}
