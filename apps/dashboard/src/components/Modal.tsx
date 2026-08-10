"use client";

import { cx } from "./cx";
import {
  type ReactNode,
  type HTMLAttributes,
  useRef,
  useEffect,
  useCallback,
  useId,
} from "react";

interface ModalProps extends HTMLAttributes<HTMLDivElement> {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  className,
  ...props
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  // Save previous focus on open
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      // Auto-focus first focusable element inside dialog
      const timer = requestAnimationFrame(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const first = dialog.querySelector<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        first?.focus();
      });
      return () => cancelAnimationFrame(timer);
    } else {
      // Restore focus on close
      previousFocusRef.current?.focus();
    }
  }, [open]);

  // ESC to close
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Focus trap: Tab cycling within dialog
      if (e.key === "Tab") {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusables = dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    },
    [onClose],
  );

  // Backdrop click closes
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-200 flex items-center justify-center bg-scrim animate-[fadeIn_0.15s_ease-out]"
      onClick={handleBackdropClick}
      {...props}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
        className={cx(
          "w-full max-w-[480px] rounded-lg border border-line bg-surface p-6",
          "animate-[slideUp_0.15s_ease-out]",
          className,
        )}
      >
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <h3 id={titleId} className="text-md font-semibold">
            {title}
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        {children}
      </div>
    </div>
  );
}

/* ── ModalActions ───────────────────────────────────────── */

export function ModalActions({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx("mt-5 flex justify-end gap-2", className)}
      {...props}
    >
      {children}
    </div>
  );
}
