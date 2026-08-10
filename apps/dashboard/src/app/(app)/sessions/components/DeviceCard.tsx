"use client";

import { type Session } from "@/lib/api/types";
import {
  Badge,
  StatusDot,
  Button,
  Card,
  cx,
} from "@/components";
import {
  IconCalendar,
  IconUser,
  IconFile,
  IconAlertCircle,
} from "@/components/icons";

/* ── Badge variant mapping ── */

const statusBadge: Record<Session["status"], "success" | "danger" | "warning" | "neutral"> = {
  connected: "success",
  disconnected: "danger",
  logged_out: "danger",
  pairing: "warning",
  created: "neutral",
};

const statusDot: Record<Session["status"], "connected" | "disconnected" | "pairing" | "error"> = {
  connected: "connected",
  disconnected: "disconnected",
  pairing: "pairing",
  logged_out: "error",
  created: "disconnected",
};

/* ── Border highlight by status ── */

function statusBorder(status: Session["status"]): string {
  if (status === "pairing") return "border-warning/30";
  if (status === "disconnected" || status === "logged_out") return "border-danger/30";
  return "";
}

/* ── Relative time helper ── */

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "Just now";
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/* ── Error banner for disconnected/logged_out ── */

function errorBanner(status: Session["status"]): string | null {
  if (status === "disconnected" || status === "logged_out") {
    return "Connection lost — device is disconnected. Reconnect to restore it.";
  }
  return null;
}

/* ── Props ── */

interface DeviceCardProps {
  session: Session;
  onShowQr?: (serial: string) => void;
  onStartPairing?: (serial: string) => void;
  onReconnect?: (serial: string) => void;
  onLogout?: (serial: string) => void;
}

export function DeviceCard({
  session,
  onShowQr,
  onStartPairing,
  onReconnect,
  onLogout,
}: DeviceCardProps) {
  const badge = errorBanner(session.status);

  return (
    <Card className={cx("flex flex-col gap-3.5 p-5 transition-colors", statusBorder(session.status))}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="font-mono text-base font-semibold truncate">
            {session.number || session.display_phone || "Unknown"}
          </div>
          {session.display_phone && session.number && (
            <div className="text-xs text-muted mt-0.5 truncate">
              {session.display_phone}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-3">
          <StatusDot state={statusDot[session.status]} />
          <Badge variant={statusBadge[session.status]} dot>
            {session.status}
          </Badge>
        </div>
      </div>

      {/* Error banner */}
      {badge && (
        <div
          role="alert"
          className="flex items-center gap-1.5 rounded-md bg-danger/8 border border-danger/20 px-3 py-2 text-xs text-danger"
        >
          <IconAlertCircle size={14} className="shrink-0" />
          <span>{badge}</span>
        </div>
      )}

      {/* Meta rows */}
      <div className="flex flex-col gap-1.5 text-xs text-muted">
        <div className="flex items-center gap-1.5">
          <IconCalendar size={12} className="shrink-0 opacity-60" />
          <span className="min-w-[90px]">Last seen</span>
          <span className="font-mono text-fg">
            {session.status === "pairing"
              ? "Pairing pending"
              : session.last_seen_at
                ? relativeTime(session.last_seen_at)
                : session.connected_at
                  ? relativeTime(session.connected_at)
                  : "—"}
          </span>
        </div>
        {session.display_phone && (
          <div className="flex items-center gap-1.5">
            <IconUser size={12} className="shrink-0 opacity-60" />
            <span className="min-w-[90px]">Display name</span>
            <span className="font-mono text-fg">{session.display_phone}</span>
          </div>
        )}
        {session.business_account_id && (
          <div className="flex items-center gap-1.5">
            <IconFile size={12} className="shrink-0 opacity-60" />
            <span className="min-w-[90px]">Account ID</span>
            <span className="font-mono text-fg">{session.business_account_id}</span>
          </div>
        )}
      </div>

      {/* Action row */}
      <div className="flex gap-1.5 mt-auto pt-3 border-t border-line-light">
        {session.status === "connected" && (
          <Button
            variant="ghost"
            size="sm"
            className="flex-1 justify-center"
            onClick={() => onLogout?.(session.id)}
          >
            Logout
          </Button>
        )}
        {session.status === "pairing" && (
          <Button
            variant="ghost"
            size="sm"
            className="flex-1 justify-center"
            onClick={() => onShowQr?.(session.id)}
          >
            Show QR
          </Button>
        )}
        {session.status === "created" && (
          <Button
            variant="primary"
            size="sm"
            className="flex-1 justify-center"
            onClick={() => onStartPairing?.(session.id)}
          >
            Start Pairing
          </Button>
        )}
        {(session.status === "disconnected" || session.status === "logged_out") && (
          <Button
            variant="primary"
            size="sm"
            className="flex-1 justify-center"
            onClick={() => onReconnect?.(session.id)}
          >
            Reconnect
          </Button>
        )}
      </div>
    </Card>
  );
}
