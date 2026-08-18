"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components";
import { IconActivity } from "@/components/icons";
import { DUMMY_ACTIVITIES, getDummyActivity } from "../dummy-data";
import type { ActivityStatus, ActivityType } from "@/lib/api/types";

/* ── Badge mapping (shared with the list) ─────────────────── */

const TYPE_LABELS: Record<ActivityType, string> = {
  api_request: "API Request",
  whatsapp_event: "WhatsApp Event",
  webhook_delivery: "Webhook",
};

const TYPE_BADGE: Record<ActivityType, "info" | "success" | "warning"> = {
  api_request: "info",
  whatsapp_event: "success",
  webhook_delivery: "warning",
};

const STATUS_BADGE: Record<ActivityStatus, "success" | "danger" | "warning"> = {
  ok: "success",
  error: "danger",
  attempted: "warning",
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function Property({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-line-light py-3 first:border-t-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="font-mono text-sm text-right break-all">{children}</dd>
    </div>
  );
}

export default function ActivityDetailPage() {
  const params = useParams<{ serial: string }>();
  const serial = Array.isArray(params.serial) ? params.serial[0] : params.serial;
  const activity = getDummyActivity(serial);

  if (!activity) {
    return (
      <div>
        <Link href="/observability" className="text-sm text-accent hover:underline">
          ← Back to Activity
        </Link>
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

  const related = DUMMY_ACTIVITIES.filter(
    (a) => a.serial !== activity.serial && a.sourceActivitySerial === activity.serial,
  );

  const payloadJson = JSON.stringify(activity.payload, null, 2);

  return (
    <div className="flex flex-col gap-6">
      {/* Back link */}
      <Link href="/observability" className="text-sm text-accent hover:underline">
        ← Back to Activity
      </Link>

      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle>
            <Badge variant={TYPE_BADGE[activity.type]}>{TYPE_LABELS[activity.type]}</Badge>
            <Badge variant={STATUS_BADGE[activity.status]} dot>
              {activity.status}
            </Badge>
          </CardTitle>
          <span className="text-sm text-muted">{formatTime(activity.createdAt)}</span>
        </CardHeader>
        <CardBody>
          <p className="text-md font-medium">{activity.summary}</p>
          <p className="mt-1 font-mono text-sm text-muted break-all">{activity.serial}</p>
        </CardBody>
      </Card>

      {/* Properties */}
      <Card>
        <CardHeader>
          <CardTitle>Properties</CardTitle>
        </CardHeader>
        <CardBody className="py-1">
          <dl>
            <Property label="Business Account">{activity.businessAccountId}</Property>
            {activity.phoneNumberId && (
              <Property label="Phone Number ID">{activity.phoneNumberId}</Property>
            )}
            {activity.waMessageId && (
              <Property label="WA Message ID">{activity.waMessageId}</Property>
            )}
            {activity.jobSerial && (
              <Property label="Job Serial">{activity.jobSerial}</Property>
            )}
            {activity.sourceActivitySerial && (
              <Property label="Source Activity">{activity.sourceActivitySerial}</Property>
            )}
            {activity.resourceType && activity.resourceSerial && (
              <Property label={`Resource (${activity.resourceType})`}>
                {activity.resourceSerial}
              </Property>
            )}
            {activity.requestSerial && (
              <Property label="Request Serial">{activity.requestSerial}</Property>
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
                      {formatTime(a.createdAt)}
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
