import { cx } from "./cx";
import type { ReactNode } from "react";

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * CSS-only tooltip. Shows on hover and focus-visible within the wrapper.
 * Respects prefers-reduced-motion via motion-reduce utility.
 */
export function Tooltip({ content, children, className }: TooltipProps) {
  return (
    <span className={cx("relative inline-flex group", className)}>
      {children}
      <span
        role="tooltip"
        className={cx(
          "pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2",
          "whitespace-nowrap rounded-sm border border-line bg-elevated px-2 py-1 text-2xs",
          "opacity-0 transition-opacity duration-fast",
          "group-hover:visible group-hover:opacity-100",
          "group-focus-within:visible group-focus-within:opacity-100",
          "[@media(prefers-reduced-motion:reduce)]:transition-none",
        )}
      >
        {content}
      </span>
    </span>
  );
}
