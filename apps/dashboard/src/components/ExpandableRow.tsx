"use client";

import { cx } from "./cx";
import { type ReactNode, useState } from "react";

interface ExpandableRowProps {
  /** The main row content (cells). */
  children: ReactNode;
  /** Content shown when expanded. */
  detail: ReactNode;
  className?: string;
}

export function ExpandableRow({ children, detail, className }: ExpandableRowProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr
        className={cx("cursor-pointer", className)}
        onClick={() => setOpen(!open)}
      >
        {children}
        {/* Chevron cell */}
        <td className="px-4 py-2.5 border-t border-line-light">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={cx(
              "text-muted transition-transform duration-normal",
              open && "rotate-90",
            )}
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={99} className="border-t border-line bg-canvas p-0">
            <div className="p-5">{detail}</div>
          </td>
        </tr>
      )}
    </>
  );
}
