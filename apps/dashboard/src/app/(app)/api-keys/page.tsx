"use client";

/* ── API Keys page (UI-2 static composition) ──
 *
 * Matches design/dashboard/api-keys.html: page header with Generate Key CTA,
 * conditional expiring-soon warning, key-count card header with a local status
 * filter, and the seven-column table (Name, Key, Scope, Created, Last Used,
 * Status, Actions).
 *
 * Scope boundaries:
 * - UI-2: Generate Key and the row action buttons are static placeholders.
 * - UI-3: Reveal/Copy are permanently unavailable for existing rows — the
 *   plaintext secret is never persisted, so they carry an explanatory disabled
 *   affordance (tooltip/title/aria-disabled) instead of pretending a value
 *   exists. Rename/Revoke remain placeholders until UI-5.
 * - The Key cell shows the redacted prefix with a decorative mask; the
 *   plaintext secret never reaches the client (the management API returns
 *   only `key_prefix`).
 * - Display status is derived locally: `revoked` (from the wire status),
 *   `expiring` (active with < 30 days until expiry), else `active`.
 * - Loading skeleton, error banner, and empty state are preserved from UI-1.
 */

import { useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  FormSelect,
  Mono,
  Table,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableWrap,
  Tooltip,
  cx,
} from "@/components";
import {
  IconCopy,
  IconEdit,
  IconEye,
  IconKey,
  IconPlus,
  IconTrash,
  IconWarning,
} from "@/components/icons";
import { useApiKeys } from "@/lib/hooks/useApiKeys";
import type { ApiKey, ApiKeyScope } from "@/lib/api/types";

const COLUMNS = [
  "Name",
  "Key",
  "Scope",
  "Created",
  "Last Used",
  "Status",
  "Actions",
] as const;

/* ── Derived display state ── */

type StatusFilter = "all" | "active" | "expiring" | "revoked";
type DisplayStatus = Exclude<StatusFilter, "all">;

const FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "expiring", label: "Expiring" },
  { value: "revoked", label: "Revoked" },
];

/** Keys with this much (or less) time remaining count as "expiring soon". */
const EXPIRING_SOON_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Decorative mask appended to the redacted prefix (matches the design's key cell). */
const MASKED_SUFFIX = "•".repeat(24);

const STATUS_META: Record<
  DisplayStatus,
  { variant: "success" | "warning" | "danger"; label: string }
> = {
  active: { variant: "success", label: "active" },
  expiring: { variant: "warning", label: "expiring" },
  revoked: { variant: "danger", label: "revoked" },
};

const SCOPE_VARIANT: Record<ApiKeyScope, "success" | "info" | "neutral"> = {
  full: "success",
  read: "info",
  write: "neutral",
};

/** Display status: revoked wins; expiring covers active keys nearing expiry. */
function displayStatus(key: ApiKey, now: number): DisplayStatus {
  if (key.status === "revoked") return "revoked";
  if (key.expires_at !== null) {
    const remaining = Date.parse(key.expires_at) - now;
    if (Number.isFinite(remaining) && remaining <= EXPIRING_SOON_MS) {
      return "expiring";
    }
  }
  return "active";
}

function maskKeyPrefix(prefix: string): string {
  return `${prefix}${MASKED_SUFFIX}`;
}

/** `2026-08-10T…` → `2026-08-10`. */
function formatCreatedAt(iso: string): string {
  return iso.slice(0, 10);
}

/** Relative "last used" label; `null` → `never`. */
function formatLastUsed(iso: string | null, now: number): string {
  if (iso === null) return "never";
  const diff = now - Date.parse(iso);
  if (!Number.isFinite(diff) || diff < 60 * 1000) return "just now";
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))} min ago`;
  if (diff < DAY_MS) return `${Math.floor(diff / (60 * 60 * 1000))} hr ago`;
  if (diff < 30 * DAY_MS) return `${Math.floor(diff / DAY_MS)} days ago`;
  return iso.slice(0, 10);
}

function StatusBadge({ apiKey, now }: { apiKey: ApiKey; now: number }) {
  const meta = STATUS_META[displayStatus(apiKey, now)];
  return (
    <Badge variant={meta.variant} dot>
      {meta.label}
    </Badge>
  );
}

function ScopeBadge({ scope }: { scope: ApiKeyScope }) {
  return <Badge variant={SCOPE_VARIANT[scope]}>{scope}</Badge>;
}

/* ── Row actions ──
 *
 * Security invariant: existing keys are unrecoverable. The management API
 * persists only a SHA-256 hash plus a display prefix, so Reveal/Copy can never
 * act on a real plaintext value. The buttons stay visible for layout parity but
 * render as disabled affordances whose tooltip/title explain why. Rename/Revoke
 * remain placeholders until UI-5 wires up the modal flows.
 */

/** Shared reason used by the Reveal/Copy explanatory affordances. */
const SECRET_NOT_RECOVERABLE =
  "the full secret isn't stored after creation and can't be recovered";

interface KeyAction {
  label: string;
  icon: React.ReactNode;
  danger?: boolean;
  /** Tooltip/title text; when set, replaces the plain action label. */
  explanation?: string;
}

function RowAction({ name, action }: { name: string; action: KeyAction }) {
  const hint = action.explanation ?? action.label;
  return (
    <Tooltip content={hint}>
      <Button
        type="button"
        variant="icon"
        size="sm"
        title={hint}
        aria-label={`${action.label} ${name}`}
        aria-disabled="true"
        className={cx(
          action.danger &&
            "border-danger/60 text-danger hover:border-danger hover:text-danger hover:bg-danger/10",
        )}
      >
        {action.icon}
      </Button>
    </Tooltip>
  );
}

function KeyActions({ name }: { name: string }) {
  const actions: KeyAction[] = [
    {
      label: "Reveal",
      icon: <IconEye size={13} />,
      explanation: `Nothing to reveal — ${SECRET_NOT_RECOVERABLE}.`,
    },
    {
      label: "Copy",
      icon: <IconCopy size={13} />,
      explanation: `Nothing to copy — ${SECRET_NOT_RECOVERABLE}.`,
    },
    { label: "Rename", icon: <IconEdit size={13} /> },
    { label: "Revoke", icon: <IconTrash size={13} />, danger: true },
  ];
  return (
    <div className="flex items-center gap-1">
      {actions.map((action) => (
        <RowAction key={action.label} name={name} action={action} />
      ))}
    </div>
  );
}

/* ── Page ── */

export default function ApiKeysPage() {
  const { keys, loading, error, refresh } = useApiKeys();
  const [filter, setFilter] = useState<StatusFilter>("all");
  // Snapshot "now" once at mount so derived labels are pure functions of state.
  const [now] = useState(() => Date.now());

  const expiringSummary = useMemo(() => {
    const expiring = keys.filter(
      (key) => displayStatus(key, now) === "expiring",
    );
    if (expiring.length === 0) return null;
    const soonest = expiring.reduce((a, b) => {
      const aTime = a.expires_at ? Date.parse(a.expires_at) : Infinity;
      const bTime = b.expires_at ? Date.parse(b.expires_at) : Infinity;
      return aTime <= bTime ? a : b;
    });
    const days = soonest.expires_at
      ? Math.max(1, Math.ceil((Date.parse(soonest.expires_at) - now) / DAY_MS))
      : 0;
    return { count: expiring.length, name: soonest.name, days };
  }, [keys, now]);

  const visibleKeys = useMemo(
    () =>
      filter === "all"
        ? keys
        : keys.filter((key) => displayStatus(key, now) === filter),
    [filter, keys, now],
  );

  const countLabel = `${keys.length} key${keys.length === 1 ? "" : "s"}`;

  return (
    <>
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">API Keys</h1>
          <p className="mt-1 text-sm text-muted">
            Manage authentication keys for your integrations
          </p>
        </div>
        {/* UI-4 wires this CTA to the generate flow; placeholder for UI-2. */}
        <Button type="button">
          <IconPlus size={14} /> Generate Key
        </Button>
      </div>

      {/* Expiring-soon warning */}
      {expiringSummary && !loading && !error && (
        <Alert variant="warning" icon={<IconWarning size={16} />}>
          <span>
            <strong>
              {expiringSummary.count === 1
                ? "1 key expiring soon."
                : `${expiringSummary.count} keys expiring soon.`}
            </strong>{" "}
            &quot;{expiringSummary.name}&quot; expires in {expiringSummary.days}{" "}
            day{expiringSummary.days === 1 ? "" : "s"}. Rotate or extend to
            avoid disruption.
          </span>
        </Alert>
      )}

      {/* List error banner */}
      {error && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-danger/20 bg-danger/8 px-4 py-3 text-sm text-danger">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void refresh()}
            className="shrink-0 font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
          >
            Try again
          </button>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && keys.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <IconKey size={16} /> API Keys
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
                      <div className="h-4 w-32 animate-pulse rounded bg-elevated" />
                    </TableCell>
                    <Mono>
                      <div className="h-4 w-36 animate-pulse rounded bg-elevated" />
                    </Mono>
                    <TableCell>
                      <div className="h-4 w-10 animate-pulse rounded bg-elevated" />
                    </TableCell>
                    <Mono>
                      <div className="h-4 w-24 animate-pulse rounded bg-elevated" />
                    </Mono>
                    <Mono>
                      <div className="h-4 w-24 animate-pulse rounded bg-elevated" />
                    </Mono>
                    <TableCell>
                      <div className="h-4 w-14 animate-pulse rounded bg-elevated" />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <div className="h-7 w-7 animate-pulse rounded bg-elevated" />
                        <div className="h-7 w-7 animate-pulse rounded bg-elevated" />
                        <div className="h-7 w-7 animate-pulse rounded bg-elevated" />
                        <div className="h-7 w-7 animate-pulse rounded bg-elevated" />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Card>
      )}

      {/* Empty state */}
      {!loading && keys.length === 0 && !error && (
        <EmptyState
          icon={<IconKey size={28} />}
          title="No API keys yet"
          description="Create an API key to authenticate programmatic access to your integration."
          action={
            <Button type="button">
              <IconPlus size={14} /> Generate Key
            </Button>
          }
        />
      )}

      {/* Keys table */}
      {keys.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{countLabel}</CardTitle>
            <FormSelect
              value={filter}
              onChange={(e) => setFilter(e.target.value as StatusFilter)}
              aria-label="Filter by status"
              className="px-2.5 py-1 text-xs"
              style={{ width: "auto" }}
            >
              {FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </FormSelect>
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
                {visibleKeys.map((key) => (
                  <TableRow key={key.serial}>
                    <TableCell className="font-medium">{key.name}</TableCell>
                    <Mono>{maskKeyPrefix(key.key_prefix)}</Mono>
                    <TableCell>
                      <ScopeBadge scope={key.scope} />
                    </TableCell>
                    <Mono>{formatCreatedAt(key.created_at)}</Mono>
                    <Mono>{formatLastUsed(key.last_used_at, now)}</Mono>
                    <TableCell>
                      <StatusBadge apiKey={key} now={now} />
                    </TableCell>
                    <TableCell>
                      <KeyActions name={key.name} />
                    </TableCell>
                  </TableRow>
                ))}
                {visibleKeys.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={COLUMNS.length}
                      className="text-center text-muted"
                    >
                      No keys match this filter.
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
