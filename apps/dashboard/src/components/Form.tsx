import { cx } from "./cx";
import {
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type ReactNode,
} from "react";

/* ── FormGroup ──────────────────────────────────────────── */

export function FormGroup({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("mb-4", className)} {...props}>
      {children}
    </div>
  );
}

/* ── FormLabel ──────────────────────────────────────────── */

export function FormLabel({
  className,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cx(
        "block text-sm font-semibold text-muted uppercase tracking-wide mb-1.5",
        className,
      )}
      {...props}
    >
      {children}
    </label>
  );
}

/* ── FormInput ──────────────────────────────────────────── */

interface FormInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Show error state (aria-invalid + red border). */
  error?: boolean;
}

export function FormInput({
  error,
  className,
  ...props
}: FormInputProps) {
  return (
    <input
      aria-invalid={error || undefined}
      className={cx(
        "w-full bg-canvas border rounded-md px-3 py-2 text-sm font-mono text-fg outline-none",
        "placeholder:text-muted transition-colors duration-normal",
        "focus:border-accent",
        error ? "border-danger" : "border-line",
        className,
      )}
      {...props}
    />
  );
}

/* ── FormSelect ─────────────────────────────────────────── */

interface FormSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
}

export function FormSelect({
  error,
  className,
  children,
  ...props
}: FormSelectProps) {
  return (
    <select
      aria-invalid={error || undefined}
      className={cx(
        "w-full bg-canvas border rounded-md px-3 py-2 text-sm font-mono text-fg outline-none",
        "transition-colors duration-normal",
        "focus:border-accent",
        error ? "border-danger" : "border-line",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

/* ── FormHint ───────────────────────────────────────────── */

interface FormHintProps extends React.HTMLAttributes<HTMLParagraphElement> {
  error?: boolean;
  children?: ReactNode;
}

export function FormHint({
  error,
  className,
  children,
  ...props
}: FormHintProps) {
  if (!children) return null;
  return (
    <p
      className={cx(
        "text-2xs mt-1",
        error ? "text-danger" : "text-muted",
        className,
      )}
      {...props}
    >
      {children}
    </p>
  );
}
