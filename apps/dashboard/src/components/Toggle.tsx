"use client";

import { cx } from "./cx";
import { useId } from "react";

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  className?: string;
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  className,
}: ToggleProps) {
  const id = useId();

  return (
    <div
      className={cx(
        "flex items-center justify-between py-3",
        className,
      )}
    >
      {(label || description) && (
        <div className="flex-1">
          {label && (
            <label
              htmlFor={id}
              className="block text-sm font-medium"
            >
              {label}
            </label>
          )}
          {description && (
            <p className="mt-0.5 text-sm text-muted">{description}</p>
          )}
        </div>
      )}
      <button
        id={id}
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative h-[22px] w-10 shrink-0 rounded-[11px] border transition-all duration-slow",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          checked
            ? "border-accent bg-accent-dim"
            : "border-line bg-elevated",
        )}
      >
        <span
          className={cx(
            "absolute left-0.5 top-0.5 h-4 w-4 rounded-full transition-all duration-slow",
            checked
              ? "translate-x-[18px] bg-accent"
              : "translate-x-0 bg-muted",
          )}
        />
      </button>
    </div>
  );
}
