import { cx } from "./cx";
import { Button } from "./Button";
import { IconEye, IconCopy } from "./icons";
import type { HTMLAttributes } from "react";

interface APIKeyRowProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  value: string;
  /** Called when the reveal button is clicked. */
  onReveal?: () => void;
  /** Called when the copy button is clicked. */
  onCopy?: () => void;
}

export function APIKeyRow({
  label,
  value,
  onReveal,
  onCopy,
  className,
  ...props
}: APIKeyRowProps) {
  return (
    <div
      className={cx(
        "flex items-center gap-3 py-3 border-b border-line-light last:border-b-0",
        className,
      )}
      {...props}
    >
      <span className="min-w-[80px] text-sm font-medium">{label}</span>
      <span className="flex-1 select-all truncate font-mono text-sm text-muted">
        {value}
      </span>
      <div className="flex shrink-0 gap-1">
        {onReveal && (
          <Button
            variant="icon"
            size="sm"
            onClick={onReveal}
            aria-label="Reveal key"
          >
            <IconEye size={14} />
          </Button>
        )}
        {onCopy && (
          <Button
            variant="icon"
            size="sm"
            onClick={onCopy}
            aria-label="Copy key"
          >
            <IconCopy size={14} />
          </Button>
        )}
      </div>
    </div>
  );
}
