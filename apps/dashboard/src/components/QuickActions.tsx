import { cx } from "./cx";
import type { ReactNode } from "react";

interface QuickAction {
  icon: ReactNode;
  label: string;
  href?: string;
  onClick?: () => void;
}

interface QuickActionsProps {
  actions: QuickAction[];
  className?: string;
}

export function QuickActions({ actions, className }: QuickActionsProps) {
  return (
    <div
      className={cx(
        "grid grid-cols-3 gap-3 max-md:grid-cols-1",
        className,
      )}
    >
      {actions.map((action) => {
        const content = (
          <>
            <span className="text-accent">{action.icon}</span>
            <span className="text-center text-sm font-medium">{action.label}</span>
          </>
        );

        const classes =
          "flex flex-col items-center gap-2 rounded-lg border border-line bg-surface p-5 transition-all duration-normal hover:border-accent hover:bg-hover";

        if (action.href) {
          return (
            <a
              key={action.label}
              href={action.href}
              className={classes}
            >
              {content}
            </a>
          );
        }

        return (
          <button
            key={action.label}
            onClick={action.onClick}
            className={classes}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}
