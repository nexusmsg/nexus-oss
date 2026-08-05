import type { ReactNode } from "react";

interface TooltipButtonProps {
  children: ReactNode;
  tooltip: string;
  disabled?: boolean;
  className?: string;
  onClick?: () => void;
}

export function TooltipButton({
  children,
  tooltip,
  disabled,
  className,
  onClick,
}: TooltipButtonProps) {
  return (
    <span className="tooltip-wrapper">
      <button
        className={className}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </button>
      {disabled && <span className="tooltip-text">{tooltip}</span>}
    </span>
  );
}
