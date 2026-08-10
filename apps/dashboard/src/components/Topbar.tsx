"use client";

import { cx } from "./cx";
import { IconSearch, IconBell, IconMenu } from "./icons";
import { Avatar } from "./Avatar";
import { type HTMLAttributes, useState, useEffect } from "react";

/* ── SearchBox ──────────────────────────────────────────── */

interface SearchBoxProps extends HTMLAttributes<HTMLDivElement> {
  placeholder?: string;
  kbdHint?: string;
}

export function SearchBox({
  placeholder = "Search devices, keys, webhooks...",
  kbdHint = "⌘K",
  className,
  ...props
}: SearchBoxProps) {
  return (
    <div
      className={cx(
        "flex flex-1 max-w-[400px] items-center gap-2 rounded-md border border-line bg-canvas px-3 py-1.5",
        className,
      )}
      {...props}
    >
      <IconSearch size={14} className="shrink-0 text-muted" />
      <input
        type="text"
        placeholder={placeholder}
        className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-muted"
      />
      {kbdHint && (
        <kbd className="shrink-0 rounded-sm border border-line bg-elevated px-1.5 py-0.5 font-mono text-2xs text-muted">
          {kbdHint}
        </kbd>
      )}
    </div>
  );
}

/* ── Topbar ─────────────────────────────────────────────── */

interface TopbarProps extends HTMLAttributes<HTMLElement> {
  /** Show mobile menu button. */
  onMenuToggle?: () => void;
  /** User initials for the avatar. */
  userInitials?: string;
  /** Show notification dot. */
  hasNotification?: boolean;
}

export function Topbar({
  onMenuToggle,
  userInitials = "AZ",
  hasNotification = true,
  className,
  children,
  ...props
}: TopbarProps) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia("(max-width:768px)");
    const check = () => setIsMobile(mql.matches);
    check();
    mql.addEventListener("change", check);
    return () => mql.removeEventListener("change", check);
  }, []);

  return (
    <header
      className={cx(
        "sticky top-0 z-50 flex h-[var(--topbar-h)] items-center border-b border-line bg-surface gap-4",
        isMobile ? "px-4" : "px-6",
        className,
      )}
      {...props}
    >
      {/* Mobile menu button */}
      {isMobile && onMenuToggle && (
        <button
          onClick={onMenuToggle}
          aria-label="Toggle menu"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <IconMenu size={18} />
        </button>
      )}

      {/* Search */}
      {children ?? <SearchBox />}

      {/* Actions */}
      <div className="flex items-center gap-2 ml-auto">
        {/* Notification button */}
        <button
          aria-label="Notifications"
          className="relative flex h-9 w-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <IconBell size={18} />
          {hasNotification && (
            <span className="absolute right-1.5 top-1.5 h-[7px] w-[7px] rounded-full bg-accent border-2 border-surface" />
          )}
        </button>

        {/* Divider */}
        <div className="h-6 w-px bg-line" />

        {/* Avatar */}
        <Avatar initials={userInitials} size="sm" />
      </div>
    </header>
  );
}
