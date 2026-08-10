import { cx } from "./cx";
import type { HTMLAttributes, ReactNode } from "react";

type AlertVariant = "info" | "warning";

interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
  icon?: ReactNode;
  children?: ReactNode;
}

const alertClasses: Record<AlertVariant, string> = {
  info: "bg-info/8 border-info/20 text-info",
  warning: "bg-warning/8 border-warning/20 text-warning",
};

export function Alert({
  variant = "info",
  icon,
  className,
  children,
  ...props
}: AlertProps) {
  return (
    <div
      role="alert"
      className={cx(
        "flex items-center gap-2 rounded-md border px-4 py-3 text-sm",
        alertClasses[variant],
        className,
      )}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </div>
  );
}
