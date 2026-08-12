"use client";

/* ── API Keys page (UI-1 shell) ──
 *
 * Minimal route shell: page header, list error banner with retry, loading
 * skeleton, empty state, and a basic data table. No final table styling, no
 * warning banner, no status filter, no reveal/copy controls, and no
 * generate/rename/revoke flows yet (UI-2+).
 */

import {
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  Mono,
  Table,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableWrap,
} from "@/components";
import { IconKey } from "@/components/icons";
import { useApiKeys } from "@/lib/hooks/useApiKeys";

const COLUMNS = ["Name", "Key Prefix", "Scope", "Status", "Created"] as const;

export default function ApiKeysPage() {
  const { keys, loading, error, refresh } = useApiKeys();

  return (
    <>
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">API Keys</h1>
          <p className="mt-1 text-sm text-muted">
            Manage authentication keys for your integrations
          </p>
        </div>
      </div>

      {/* List error banner */}
      {error && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-danger/20 bg-danger/8 px-4 py-3 text-sm text-danger">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void refresh()}
            className="shrink-0 font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
          >
            Try again
          </button>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && keys.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <IconKey size={16} /> API Keys
            </CardTitle>
          </CardHeader>
          <TableWrap>
            <Table>
              <TableHead>
                <TableRow>
                  {COLUMNS.map((col) => (
                    <TableHeaderCell key={col}>{col}</TableHeaderCell>
                  ))}
                </TableRow>
              </TableHead>
              <tbody>
                {[0, 1, 2].map((i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <div className="h-4 w-32 animate-pulse rounded bg-elevated" />
                    </TableCell>
                    <Mono>
                      <div className="h-4 w-24 animate-pulse rounded bg-elevated" />
                    </Mono>
                    <TableCell>
                      <div className="h-4 w-10 animate-pulse rounded bg-elevated" />
                    </TableCell>
                    <TableCell>
                      <div className="h-4 w-12 animate-pulse rounded bg-elevated" />
                    </TableCell>
                    <TableCell>
                      <div className="h-4 w-32 animate-pulse rounded bg-elevated" />
                    </TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Card>
      )}

      {/* Empty state */}
      {!loading && keys.length === 0 && !error && (
        <EmptyState
          icon={<IconKey size={28} />}
          title="No API keys yet"
          description="Create an API key to authenticate programmatic access to your integration."
        />
      )}

      {/* Basic data table */}
      {keys.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <IconKey size={16} /> API Keys
            </CardTitle>
          </CardHeader>
          <TableWrap>
            <Table>
              <TableHead>
                <TableRow>
                  {COLUMNS.map((col) => (
                    <TableHeaderCell key={col}>{col}</TableHeaderCell>
                  ))}
                </TableRow>
              </TableHead>
              <tbody>
                {keys.map((key) => (
                  <TableRow key={key.serial}>
                    <TableCell>{key.name}</TableCell>
                    <Mono>{key.key_prefix}</Mono>
                    <TableCell>{key.scope}</TableCell>
                    <TableCell>{key.status}</TableCell>
                    <TableCell>{key.created_at}</TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Card>
      )}
    </>
  );
}
