import { cx } from "./cx";
import type { HTMLAttributes, ReactNode } from "react";

/* ── Badge ──────────────────────────────────────────────── */

type BadgeVariant = "success" | "danger" | "warning" | "info" | "neutral";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  /** Show a small dot before the children (currentColor circle). */
  dot?: boolean;
  children?: ReactNode;
}

const badgeVariantClasses: Record<BadgeVariant, string> = {
  success: "bg-success/12 text-success",
  danger: "bg-danger/12 text-danger",
  warning: "bg-warning/12 text-warning",
  info: "bg-info/12 text-info",
  neutral: "bg-elevated text-muted",
};

export function Badge({
  variant = "neutral",
  dot = false,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-pill px-2 py-0.5 font-mono text-2xs font-semibold",
        badgeVariantClasses[variant],
        className,
      )}
      {...props}
    >
      {dot && (
        <span className="h-1.5 w-1.5 rounded-full bg-current shrink-0" />
      )}
      {children}
    </span>
  );
}

/* ── StatusDot ──────────────────────────────────────────── */

type StatusDotState = "connected" | "disconnected" | "pairing" | "error";

interface StatusDotProps extends HTMLAttributes<HTMLSpanElement> {
  state: StatusDotState;
  size?: number;
}

const stateClasses: Record<StatusDotState, string> = {
  connected: "bg-success shadow-glow",
  disconnected: "bg-danger",
  pairing: "bg-warning animate-pulse",
  error: "bg-danger",
};

const ariaLabels: Record<StatusDotState, string> = {
  connected: "Connected",
  disconnected: "Disconnected",
  pairing: "Pairing",
  error: "Error",
};

export function StatusDot({ state, size = 10, className, ...props }: StatusDotProps) {
  return (
    <span
      role="status"
      aria-label={ariaLabels[state]}
      className={cx(
        "shrink-0 rounded-full",
        stateClasses[state],
        className,
      )}
      style={{ width: size, height: size }}
      {...props}
    />
  );
}
