import { cx } from "./cx";
import { type TdHTMLAttributes, type ThHTMLAttributes } from "react";

/* ── TableWrap ──────────────────────────────────────────── */

export function TableWrap({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("overflow-x-auto", className)} {...props}>
      {children}
    </div>
  );
}

/* ── Table ──────────────────────────────────────────────── */

export function Table({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={cx("w-full border-collapse text-base", className)}
      {...props}
    >
      {children}
    </table>
  );
}

/* ── TableHead ──────────────────────────────────────────── */

export function TableHead({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={cx("bg-elevated", className)} {...props}>
      {children}
    </thead>
  );
}

/* ── TableHeaderCell ────────────────────────────────────── */

export function TableHeaderCell({
  className,
  children,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cx(
        "px-4 py-2.5 text-left text-2xs font-semibold uppercase tracking-wider text-muted whitespace-nowrap",
        className,
      )}
      {...props}
    >
      {children}
    </th>
  );
}

/* ── TableRow ───────────────────────────────────────────── */

export function TableRow({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cx("hover:bg-hover transition-colors duration-fast", className)}
      {...props}
    >
      {children}
    </tr>
  );
}

/* ── TableCell ──────────────────────────────────────────── */

export function TableCell({
  className,
  children,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cx(
        "px-4 py-2.5 border-t border-line-light whitespace-nowrap",
        className,
      )}
      {...props}
    >
      {children}
    </td>
  );
}

/* ── Mono ───────────────────────────────────────────────── */

export function Mono({
  className,
  children,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cx(
        "px-4 py-2.5 border-t border-line-light whitespace-nowrap font-mono text-sm tabular-nums",
        className,
      )}
      {...props}
    >
      {children}
    </td>
  );
}
