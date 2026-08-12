"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Badge,
  Button,
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
  Tooltip,
  cx,
} from "@/components";
import {
  IconEdit,
  IconError,
  IconEye,
  IconEyeOff,
  IconPlay,
  IconPlus,
  IconTrash,
  IconWebhook,
} from "@/components/icons";
import { testWebhook } from "@/lib/api/webhooks";
import type {
  CreateWebhookInput,
  UpdateWebhookInput,
  WebhookConfig,
  WebhookTestResult,
} from "@/lib/api/types";
import { useWebhooks } from "@/lib/hooks/useWebhooks";
import { useSessions } from "@/lib/hooks/useSessions";
import { WebhookFormModal } from "./components/WebhookFormModal";
import { DeleteConfirmModal } from "./components/DeleteConfirmModal";

/* ── Helpers ── */

function maskSecret(secret: string): string {
  if (secret.length <= 12) return "••••••••";
  return `${secret.slice(0, 6)}••••••${secret.slice(-4)}`;
}

/** Compact one-line probe result shown under a row's actions. */
function TestResultLine({ result }: { result: WebhookTestResult }) {
  const label =
    result.outcome === "responded"
      ? `HTTP ${result.status}`
      : (result.error?.code ?? "failed");
  const detail =
    result.outcome === "responded" ? result.status_text : result.error?.message;

  return (
    <div className="flex max-w-full items-center gap-1.5 font-mono text-2xs">
      <Badge variant={result.ok ? "success" : "danger"}>{label}</Badge>
      {detail !== "" && detail !== undefined && (
        <span className="block max-w-[180px] truncate text-muted" title={detail}>
          {detail}
        </span>
      )}
      <span className="text-muted">{result.duration_ms}ms</span>
    </div>
  );
}

/* ── Page ── */

export default function WebhooksPage() {
  const { webhooks, loading, error, refresh, create, update, remove, toggleEnabled } =
    useWebhooks();
  const { sessions, loading: sessionsLoading } = useSessions();

  // Modal states
  const [addOpen, setAddOpen] = useState(false);
  const [editWebhook, setEditWebhook] = useState<WebhookConfig | null>(null);
  const [deleteWebhook, setDeleteWebhook] = useState<WebhookConfig | null>(null);

  // Row-level mutation feedback (toggle failures stay visible for retry).
  const [actionError, setActionError] = useState<string | null>(null);
  const [togglingSerial, setTogglingSerial] = useState<string | null>(null);

  // One-shot test feedback (per-serial: probe result or client-side failure).
  const [testingSerial, setTestingSerial] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, WebhookTestResult>>(
    () => ({}),
  );
  const [testErrors, setTestErrors] = useState<Record<string, string>>(() => ({}));

  // Secret reveal state (per-serial)
  const [revealedSecrets, setRevealedSecrets] = useState<Set<string>>(
    () => new Set(),
  );

  // Phones that already have a webhook config — excluded from the create selector.
  const configuredPhoneNumberIds = useMemo(
    () => webhooks.map((wh) => wh.phone_number_id),
    [webhooks],
  );

  const toggleRevealSecret = useCallback((serial: string) => {
    setRevealedSecrets((prev) => {
      const next = new Set(prev);
      if (next.has(serial)) next.delete(serial);
      else next.add(serial);
      return next;
    });
  }, []);

  const handleFormSubmit = useCallback(
    async (input: CreateWebhookInput | UpdateWebhookInput) => {
      setActionError(null);
      if (editWebhook) {
        await update(editWebhook.serial, input as UpdateWebhookInput);
      } else {
        await create(input as CreateWebhookInput);
      }
    },
    [create, editWebhook, update],
  );

  const handleToggle = useCallback(
    async (serial: string, enabled: boolean) => {
      setActionError(null);
      setTogglingSerial(serial);
      try {
        await toggleEnabled(serial, enabled);
      } catch (e) {
        setActionError(
          e instanceof Error ? e.message : "Failed to update webhook status",
        );
      } finally {
        setTogglingSerial((cur) => (cur === serial ? null : cur));
      }
    },
    [toggleEnabled],
  );

  const handleTest = useCallback(async (wh: WebhookConfig) => {
    // Clear any previous result for this serial so stale feedback disappears.
    setTestResults((prev) => {
      if (!(wh.serial in prev)) return prev;
      const next = { ...prev };
      delete next[wh.serial];
      return next;
    });
    setTestErrors((prev) => {
      if (!(wh.serial in prev)) return prev;
      const next = { ...prev };
      delete next[wh.serial];
      return next;
    });
    setTestingSerial(wh.serial);
    try {
      const result = await testWebhook(wh.serial);
      setTestResults((prev) => ({ ...prev, [wh.serial]: result }));
    } catch (e) {
      setTestErrors((prev) => ({
        ...prev,
        [wh.serial]: e instanceof Error ? e.message : "Webhook test failed",
      }));
    } finally {
      setTestingSerial((cur) => (cur === wh.serial ? null : cur));
    }
  }, []);

  return (
    <>
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Webhooks</h1>
          <p className="mt-1 text-sm text-muted">
            Configure endpoints for inbound message forwarding
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <IconPlus size={14} /> Add Webhook
        </Button>
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

      {/* Row-action error banner (toggle failures) */}
      {actionError && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-danger/20 bg-danger/8 px-4 py-3 text-sm text-danger">
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            aria-label="Dismiss"
            className="shrink-0 text-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
          >
            ✕
          </button>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && webhooks.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <IconWebhook size={16} /> Configured Webhooks
            </CardTitle>
          </CardHeader>
          <TableWrap>
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Phone Number</TableHeaderCell>
                  <TableHeaderCell>Webhook URL</TableHeaderCell>
                  <TableHeaderCell>Secret</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Actions</TableHeaderCell>
                </TableRow>
              </TableHead>
              <tbody>
                {[0, 1, 2].map((i) => (
                  <TableRow key={i}>
                    <Mono>
                      <div className="h-4 w-32 animate-pulse rounded bg-elevated" />
                    </Mono>
                    <Mono>
                      <div className="h-4 w-52 animate-pulse rounded bg-elevated" />
                    </Mono>
                    <TableCell>
                      <div className="h-4 w-12 animate-pulse rounded bg-elevated" />
                    </TableCell>
                    <TableCell>
                      <div className="h-4 w-14 animate-pulse rounded bg-elevated" />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <div className="h-7 w-7 animate-pulse rounded bg-elevated" />
                        <div className="h-7 w-10 animate-pulse rounded bg-elevated" />
                        <div className="h-7 w-7 animate-pulse rounded bg-elevated" />
                        <div className="h-7 w-7 animate-pulse rounded bg-elevated" />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Card>
      )}

      {/* Empty state */}
      {!loading && webhooks.length === 0 && !error && (
        <EmptyState
          icon={<IconWebhook size={28} />}
          title="No webhooks configured"
          description="Add a webhook to start receiving real-time event notifications for your WhatsApp messages."
          action={
            <Button onClick={() => setAddOpen(true)}>
              <IconPlus size={14} /> Add Webhook
            </Button>
          }
        />
      )}

      {/* Webhook table */}
      {webhooks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <IconWebhook size={16} /> Configured Webhooks
            </CardTitle>
          </CardHeader>
          <TableWrap>
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Phone Number</TableHeaderCell>
                  <TableHeaderCell>Webhook URL</TableHeaderCell>
                  <TableHeaderCell>Secret</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Actions</TableHeaderCell>
                </TableRow>
              </TableHead>
              <tbody>
                {webhooks.map((wh) => {
                  const session = sessions.find(
                    (s) => s.phone_number_id === wh.phone_number_id,
                  );
                  const phoneDisplay =
                    session?.number || session?.display_phone || wh.phone_number_id;
                  const isRevealed = revealedSecrets.has(wh.serial);
                  const isToggling = togglingSerial === wh.serial;
                  const isTesting = testingSerial === wh.serial;
                  const testResult = testResults[wh.serial];
                  const testError = testErrors[wh.serial];

                  return (
                    <TableRow key={wh.serial}>
                      <Mono>{phoneDisplay}</Mono>
                      <Mono className="max-w-[280px]">
                        <Tooltip content={wh.webhook_url}>
                          <span className="block cursor-default truncate">
                            {wh.webhook_url}
                          </span>
                        </Tooltip>
                      </Mono>
                      <TableCell>
                        {wh.webhook_secret ? (
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs text-fg">
                              {isRevealed
                                ? wh.webhook_secret
                                : maskSecret(wh.webhook_secret)}
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleRevealSecret(wh.serial)}
                              aria-label={isRevealed ? "Hide secret" : "Reveal secret"}
                              className="flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            >
                              {isRevealed ? (
                                <IconEyeOff size={12} />
                              ) : (
                                <IconEye size={12} />
                              )}
                            </button>
                          </div>
                        ) : (
                          <Badge variant="neutral">not set</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={wh.enabled ? "success" : "warning"} dot>
                          {wh.enabled ? "active" : "paused"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1.5">
                          <div className="flex items-center gap-1">
                            <Tooltip content="Test webhook">
                              <Button
                                variant="icon"
                                size="sm"
                                loading={isTesting}
                                onClick={() => handleTest(wh)}
                                aria-label="Test webhook"
                              >
                                <IconPlay size={13} />
                              </Button>
                            </Tooltip>
                            <Tooltip content={wh.enabled ? "Pause" : "Resume"}>
                              <button
                                type="button"
                                role="switch"
                                aria-checked={wh.enabled}
                                aria-label={wh.enabled ? "Pause webhook" : "Resume webhook"}
                                disabled={isToggling}
                                onClick={() => handleToggle(wh.serial, !wh.enabled)}
                                className={cx(
                                  "relative h-[22px] w-10 shrink-0 rounded-[11px] border transition-all duration-slow",
                                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                                  "disabled:opacity-50 disabled:cursor-not-allowed",
                                  wh.enabled
                                    ? "border-accent bg-accent-dim"
                                    : "border-line bg-elevated",
                                )}
                              >
                                <span
                                  className={cx(
                                    "absolute left-0.5 top-0.5 h-4 w-4 rounded-full transition-all duration-slow",
                                    wh.enabled
                                      ? "translate-x-[18px] bg-accent"
                                      : "translate-x-0 bg-muted",
                                  )}
                                />
                              </button>
                            </Tooltip>
                            <Button
                              variant="icon"
                              size="sm"
                              onClick={() => setEditWebhook(wh)}
                              aria-label="Edit webhook"
                            >
                              <IconEdit size={13} />
                            </Button>
                            <Button
                              variant="icon"
                              size="sm"
                              className="border-danger/60 text-danger hover:border-danger hover:text-danger hover:bg-danger/10"
                              onClick={() => setDeleteWebhook(wh)}
                              aria-label="Delete webhook"
                            >
                              <IconTrash size={13} />
                            </Button>
                          </div>
                          {testResult && <TestResultLine result={testResult} />}
                          {testError && (
                            <div className="flex items-center gap-1.5 font-mono text-2xs text-danger">
                              <IconError size={12} />
                              <span
                                className="block max-w-[220px] truncate"
                                title={testError}
                              >
                                {testError}
                              </span>
                            </div>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        </Card>
      )}

      {/* Add Modal */}
      <WebhookFormModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        sessions={sessions}
        sessionsLoading={sessionsLoading}
        configuredPhoneNumberIds={configuredPhoneNumberIds}
        onSubmit={handleFormSubmit}
      />

      {/* Edit Modal */}
      <WebhookFormModal
        open={editWebhook !== null}
        onClose={() => setEditWebhook(null)}
        webhook={editWebhook}
        sessions={sessions}
        sessionsLoading={sessionsLoading}
        onSubmit={handleFormSubmit}
      />

      {/* Delete Confirm */}
      <DeleteConfirmModal
        open={deleteWebhook !== null}
        onClose={() => setDeleteWebhook(null)}
        webhook={deleteWebhook}
        onDelete={remove}
      />
    </>
  );
}
