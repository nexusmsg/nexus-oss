import { cx } from "./cx";
import type { HTMLAttributes, ReactNode } from "react";

interface StatCardProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  value: string;
  /** Change indicator: "up" = success, "down" = danger, "neutral" = muted. */
  change?: {
    text: string;
    direction: "up" | "down" | "neutral";
  };
  /** Optional icon shown next to the label. */
  icon?: ReactNode;
}

const changeColors = {
  up: "text-success",
  down: "text-danger",
  neutral: "text-muted",
};

export function StatCard({
  label,
  value,
  change,
  icon,
  className,
  ...props
}: StatCardProps) {
  return (
    <div
      className={cx("rounded-lg border border-line bg-surface p-5", className)}
      {...props}
    >
      <div className="mb-2 flex items-center gap-1.5 text-sm uppercase tracking-wide text-muted">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-bold font-mono tabular-nums tracking-tight">
        {value}
      </div>
      {change && (
        <div
          className={cx(
            "mt-1 flex items-center gap-1 font-mono text-sm",
            changeColors[change.direction],
          )}
        >
          {change.direction === "up" && "↑ "}
          {change.direction === "down" && "↓ "}
          {change.text}
        </div>
      )}
    </div>
  );
}
