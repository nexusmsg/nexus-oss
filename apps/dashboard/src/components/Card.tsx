import { cx } from "./cx";
import type { HTMLAttributes, ReactNode } from "react";

/* ── Card ───────────────────────────────────────────────── */

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "danger-zone";
  children?: ReactNode;
}

export function Card({ variant = "default", className, children, ...props }: CardProps) {
  return (
    <div
      className={cx(
        "bg-surface border rounded-lg overflow-hidden",
        variant === "danger-zone" ? "border-danger/40" : "border-line",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/* ── CardHeader ─────────────────────────────────────────── */

interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

export function CardHeader({ className, children, ...props }: CardHeaderProps) {
  return (
    <div
      className={cx(
        "flex items-center justify-between px-5 py-4 border-b border-line",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/* ── CardTitle ──────────────────────────────────────────── */

interface CardTitleProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

export function CardTitle({ className, children, ...props }: CardTitleProps) {
  return (
    <div
      className={cx("flex items-center gap-2 text-md font-semibold", className)}
      {...props}
    >
      {children}
    </div>
  );
}

/* ── CardBody ───────────────────────────────────────────── */

interface CardBodyProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

export function CardBody({ className, children, ...props }: CardBodyProps) {
  return (
    <div className={cx("p-5", className)} {...props}>
      {children}
    </div>
  );
}
