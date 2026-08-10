import { cx } from "./cx";
import type { HTMLAttributes } from "react";

interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  initials: string;
  /** Size variant. */
  size?: "sm" | "default";
}

const sizeClasses = {
  sm: "h-7 w-7 text-2xs",
  default: "h-8 w-8 text-xs",
};

export function Avatar({
  initials,
  size = "default",
  className,
  ...props
}: AvatarProps) {
  return (
    <div
      className={cx(
        "flex shrink-0 items-center justify-center rounded-full bg-accent-dim font-semibold text-accent",
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {initials}
    </div>
  );
}
