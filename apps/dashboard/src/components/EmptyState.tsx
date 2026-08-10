import { cx } from "./cx";
import type { ReactNode } from "react";

interface EmptyStateProps {
  /** Icon element rendered inside the circle. */
  icon: ReactNode;
  title: string;
  description: string;
  /** Optional call-to-action slot (e.g. a Button). */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cx(
        "flex flex-col items-center justify-center p-16 text-center",
        className,
      )}
    >
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-accent-dim text-accent">
        {icon}
      </div>
      <h3 className="mb-2 text-lg font-semibold">{title}</h3>
      <p className="mb-5 max-w-sm text-sm leading-relaxed text-muted">
        {description}
      </p>
      {action}
    </div>
  );
}
