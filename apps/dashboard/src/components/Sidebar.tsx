"use client";

import { cx } from "./cx";
import { IconNexus } from "./icons";
import { Badge } from "./Badge";
import { Avatar } from "./Avatar";
import { type ReactNode, useState, useEffect } from "react";

interface NavItem {
  icon: ReactNode;
  label: string;
  href?: string;
  active?: boolean;
  count?: number;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

interface SidebarProps {
  /** Nav groups rendered as sections. */
  groups: NavGroup[];
  /** User info displayed in footer. */
  user?: {
    name: string;
    role: string;
    initials: string;
  };
  /** Mobile open state — controlled from parent. */
  open?: boolean;
  /** Called when mobile overlay/backdrop is clicked. */
  onClose?: () => void;
  className?: string;
}

export function Sidebar({
  groups,
  user,
  open = false,
  onClose,
  className,
}: SidebarProps) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia("(max-width:768px)");
    const check = () => setIsMobile(mql.matches);
    check();
    mql.addEventListener("change", check);
    return () => mql.removeEventListener("change", check);
  }, []);

  const sidebar = (
    <aside
      className={cx(
        "flex h-full w-[var(--sidebar-w)] flex-col bg-surface border-r border-line",
        "fixed inset-y-0 left-0 z-100",
        "max-md:transition-transform max-md:duration-slow",
        isMobile && !open && "-translate-x-full",
        isMobile && open && "translate-x-0",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-line px-5 py-4">
        <IconNexus size={22} className="text-accent shrink-0" />
        <span className="text-lg font-bold tracking-tight">Nexus</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {groups.map((section) => (
          <div key={section.title} className="mb-1">
            <div className="px-3 pt-3 pb-1.5 text-2xs font-semibold uppercase tracking-wider text-muted">
              {section.title}
            </div>
            {section.items.map((item) => (
              <a
                key={item.label}
                href={item.href || "#"}
                className={cx(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-fast",
                  item.active
                    ? "bg-accent-dim text-accent"
                    : "text-muted hover:bg-hover hover:text-fg",
                )}
              >
                <span className="shrink-0 [&_svg]:h-4 [&_svg]:w-4">
                  {item.icon}
                </span>
                {item.label}
                {item.count !== undefined && (
                  <Badge className="ml-auto">{item.count}</Badge>
                )}
              </a>
            ))}
          </div>
        ))}
      </nav>

      {/* Footer */}
      {user && (
        <div className="flex items-center gap-2.5 border-t border-line px-4 py-3">
          <Avatar initials={user.initials} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{user.name}</div>
            <div className="text-2xs text-muted">{user.role}</div>
          </div>
        </div>
      )}
    </aside>
  );

  return (
    <>
      {sidebar}
      {/* Mobile overlay backdrop */}
      {isMobile && open && (
        <div
          className="fixed inset-0 z-90 bg-scrim"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
    </>
  );
}
