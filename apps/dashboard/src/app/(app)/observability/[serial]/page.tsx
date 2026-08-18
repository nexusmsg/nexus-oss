"use client";

/* ── Activity Detail Page ──
 *
 * Fetches a single activity plus its related rows from
 * `GET /api/v1/observability/:serial` (bootstrap auth) and renders the
 * header, correlation properties, formatted-JSON payload, and a clickable
 * Related Activity list. Handles loading (AC-108), not-found (AC-107), and
 * fetch error states.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components";
import { IconActivity } from "@/components/icons";
import { getActivity } from "@/lib/api/observability";
import {
  Property,
  RESOURCE_ROUTE,
  STATUS_BADGE,
  TYPE_BADGE,
  TYPE_LABELS,
  formatTime,
} from "@/lib/observability/activity";
import type { ActivityEvent } from "@/lib/api/types";
import { ApiError } from "@/lib/api/types";

/* ── Loading skeleton (AC-108) ────────────────────────────── */

function DetailSkeleton() {
  const pulse = "h-4 animate-pulse rounded bg-elevated";
  return (
    <div className="flex flex-col gap-6">
      <div className={`w-24 ${pulse}`} />
      <Card>
        <CardHeader>
          <div className={`w-40 ${pulse}`} />
        </CardHeader>
        <CardBody className="space-y-2">
          <div className={`w-3/4 ${pulse}`} />
          <div className={`w-1/2 ${pulse}`} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader>
          <div className={`w-24 ${pulse}`} />
        </CardHeader>
        <CardBody className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center justify-between gap-4 border-t border-line-light py-3 first:border-t-0">
              <div className={`w-32 ${pulse}`} />
              <div className={`w-40 ${pulse}`} />
            </div>
          ))}
        </CardBody>
      </Card>
      <Card>
        <CardHeader>
          <div className={`w-20 ${pulse}`} />
        </CardHeader>
        <CardBody className="p-0">
          <div className={`m-5 h-40 ${pulse}`} />
        </CardBody>
      </Card>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────── */

export default function ActivityDetailPage() {
  const params = useParams<{ serial: string }>();
  const serial = Array.isArray(params.serial) ? params.serial[0] : params.serial;

  const [state, setState] = useState<"loading" | "ready" | "notfound" | "error">(
    "loading",
  );
  const [activity, setActivity] = useState<ActivityEvent | null>(null);
  const [related, setRelated] = useState<ActivityEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(async (s: string) => {
    if (!mountedRef.current) return;
    setState("loading");
    setError(null);
    try {
      const res = await getActivity(s);
      if (!mountedRef.current) return;
      setActivity(res.activity);
      setRelated(res.related);
      setState("ready");
    } catch (e) {
      if (!mountedRef.current) return;
      if (e instanceof ApiError && e.status === 404) {
        setState("notfound");
        return;
      }
      setError(e instanceof Error ? e.message : "Failed to load activity");
      setState("error");
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch, guarded by mountedRef
    void load(serial);
    return () => {
      mountedRef.current = false;
    };
  }, [serial, load]);

  const BackLink = (
    <Link href="/observability" className="text-sm text-accent hover:underline">
      ← Back to Activity
    </Link>
  );

  if (state === "loading") {
    return (
      <div className="flex flex-col gap-6">
        {BackLink}
        <DetailSkeleton />
      </div>
    );
  }

  if (state === "notfound") {
    return (
      <div>
        {BackLink}
        <div className="mt-8 flex flex-col items-center justify-center rounded-lg border border-line bg-surface p-16 text-center">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-accent-dim text-accent">
            <IconActivity size={28} />
          </div>
          <h2 className="mb-2 text-lg font-semibold">Activity not found</h2>
          <p className="mb-5 max-w-sm text-sm text-muted">
            The activity you are looking for does not exist or has been removed.
          </p>
          <Link href="/observability" className="text-sm font-medium text-accent hover:underline">
            Back to Activity
          </Link>
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="flex flex-col gap-6">
        {BackLink}
        <div className="flex items-center justify-between gap-3 rounded-md border border-danger/20 bg-danger/8 px-4 py-3 text-sm text-danger">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void load(serial)}
            className="shrink-0 font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const activityRow = activity!;
  const payloadJson = JSON.stringify(activityRow.payload, null, 2);

  return (
    <div className="flex flex-col gap-6">
      {/* Back link */}
      {BackLink}

      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle>
            <Badge variant={TYPE_BADGE[activityRow.type]}>
              {TYPE_LABELS[activityRow.type]}
            </Badge>
            <Badge variant={STATUS_BADGE[activityRow.status]} dot>
              {activityRow.status}
            </Badge>
          </CardTitle>
          <span className="text-sm text-muted">
            {formatTime(activityRow.createdAt, { withSeconds: true })}
          </span>
        </CardHeader>
        <CardBody>
          <p className="text-md font-medium">{activityRow.summary}</p>
          <p className="mt-1 font-mono text-sm text-muted break-all">
            {activityRow.serial}
          </p>
        </CardBody>
      </Card>

      {/* Properties */}
      <Card>
        <CardHeader>
          <CardTitle>Properties</CardTitle>
        </CardHeader>
        <CardBody className="py-1">
          <dl>
            <Property label="Business Account">{activityRow.businessAccountId}</Property>
            {activityRow.phoneNumberId && (
              <Property label="Phone Number ID">{activityRow.phoneNumberId}</Property>
            )}
            {activityRow.waMessageId && (
              <Property label="WA Message ID">{activityRow.waMessageId}</Property>
            )}
            {activityRow.jobSerial && (
              <Property label="Job Serial">{activityRow.jobSerial}</Property>
            )}
            {activityRow.sourceActivitySerial && (
              <Property label="Source Activity">
                {activityRow.sourceActivitySerial}
              </Property>
            )}
            {activityRow.resourceType && activityRow.resourceSerial && (
              <Property label={`Resource (${activityRow.resourceType})`}>
                {RESOURCE_ROUTE[activityRow.resourceType] ? (
                  <Link
                    href={RESOURCE_ROUTE[activityRow.resourceType]!}
                    className="text-accent hover:underline"
                  >
                    {activityRow.resourceSerial}
                  </Link>
                ) : (
                  activityRow.resourceSerial
                )}
              </Property>
            )}
            {activityRow.requestSerial && (
              <Property label="Request Serial">{activityRow.requestSerial}</Property>
            )}
          </dl>
        </CardBody>
      </Card>

      {/* Payload */}
      <Card>
        <CardHeader>
          <CardTitle>Payload</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          <pre className="overflow-x-auto p-5 font-mono text-sm text-muted">
            {payloadJson}
          </pre>
        </CardBody>
      </Card>

      {/* Related */}
      {related.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Related Activity</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            <table className="w-full border-collapse text-base">
              <tbody>
                {related.map((a) => (
                  <tr
                    key={a.serial}
                    className="cursor-pointer transition-colors duration-fast hover:bg-hover"
                    onClick={() => {
                      window.location.href = `/observability/${encodeURIComponent(a.serial)}`;
                    }}
                  >
                    <td className="px-5 py-2.5 border-t border-line-light">
                      <Badge variant={TYPE_BADGE[a.type]}>{TYPE_LABELS[a.type]}</Badge>
                    </td>
                    <td className="px-5 py-2.5 border-t border-line-light font-medium">
                      {a.summary}
                    </td>
                    <td className="px-5 py-2.5 border-t border-line-light">
                      <Badge variant={STATUS_BADGE[a.status]} dot>
                        {a.status}
                      </Badge>
                    </td>
                    <td className="px-5 py-2.5 border-t border-line-light text-sm text-muted whitespace-nowrap">
                      {formatTime(a.createdAt, { withSeconds: true })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}