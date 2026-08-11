import { cx } from "./cx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "ghost" | "danger" | "icon" | "topbar";
type ButtonSize = "sm" | "default";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Show a loading indicator. The design has no spinner in the static HTML;
   *  this border-spin is a derived addition for async states. It uses an
   *  accent-colored ring that rotates, matching the token palette. */
  loading?: boolean;
  children?: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-canvas hover:bg-accent-hover active:opacity-90",
  ghost:
    "border border-line text-fg hover:border-accent hover:text-accent active:opacity-80",
  danger:
    "border border-danger text-danger hover:bg-danger/10 active:opacity-80",
  icon: "w-8 h-8 border border-line text-muted hover:border-accent hover:text-accent hover:bg-accent-dim active:opacity-80",
  topbar: "w-9 h-9 border-none text-muted hover:bg-hover hover:text-fg active:opacity-80",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1 text-xs",
  default: "px-4 py-2 text-base",
};

export function Button({
  variant = "primary",
  size = "default",
  loading = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      disabled={isDisabled}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-semibold transition-all duration-normal",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        "[&_svg]:shrink-0 [&_svg]:size-3.5",
        variant !== "icon" && variant !== "topbar" && sizeClasses[size],
        variantClasses[variant],
        isDisabled && "opacity-50 cursor-not-allowed pointer-events-none",
        loading && "relative",
        className,
      )}
      {...props}
    >
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span
            className="h-4 w-4 rounded-full border-2 border-accent/30 border-t-accent"
            style={{ animation: "nexus-spin 0.6s linear infinite" }}
          />
        </span>
      )}
      <span
        className={cx(
          "inline-flex items-center justify-center gap-1.5",
          loading && "invisible",
        )}
      >
        {children}
      </span>
    </button>
  );
}
