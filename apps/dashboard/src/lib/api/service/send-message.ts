/**
 * Application service implementing SendMessagePort: enqueue a job, then poll
 * until it reaches a terminal status or the deadline elapses. Imports only
 * domain + ports.
 */

import { RequestAbortedError, SendTimeoutError } from "../domain/errors";
import type { JobTransport, PollResult } from "../ports/job-transport";
import type { SendMessageInput, SendMessagePort, SendMessageResult } from "../ports/send-message";

/** Terminal statuses produced by the worker queue consumer. */
const TERMINAL_STATUSES = new Set(["succeeded", "failed"]);

export interface SendMessageServiceDeps {
  transport: JobTransport;
  sendTimeoutMs: number;
  resultPollMs: number;
}

export class SendMessageService implements SendMessagePort {
  private readonly transport: JobTransport;
  private readonly sendTimeoutMs: number;
  private readonly resultPollMs: number;

  constructor({ transport, sendTimeoutMs, resultPollMs }: SendMessageServiceDeps) {
    this.transport = transport;
    this.sendTimeoutMs = sendTimeoutMs;
    this.resultPollMs = resultPollMs;
  }

  async send(input: SendMessageInput): Promise<SendMessageResult> {
    const serial = await this.transport.enqueue({
      phoneNumberId: input.phoneNumberId,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
    });

    const outcome = await this.waitForResult(serial, input.signal);

    if (outcome.status === "succeeded") {
      const wamid = extractWaMessageId(outcome.result);
      if (wamid !== null) {
        return { status: "succeeded", wamid };
      }
      // The job succeeded but carried no wamid: a data anomaly. Surfaced as a
      // failed result so the HTTP adapter maps it to the same 500 envelope.
      return { status: "failed", reason: "Internal server error" };
    }

    return {
      status: "failed",
      reason:
        outcome.lastError !== null && outcome.lastError !== ""
          ? outcome.lastError
          : "Unable to send message",
    };
  }

  /**
   * Poll the job row until it reaches a terminal status or the deadline
   * elapses. `Date.now()` is used for the deadline so the wall clock governs
   * the timeout. Throws `SendTimeoutError` on deadline, `RequestAbortedError`
   * when the caller's signal fires.
   */
  private async waitForResult(serial: string, signal?: AbortSignal): Promise<PollResult> {
    const deadline = Date.now() + this.sendTimeoutMs;
    for (;;) {
      if (signal !== undefined && signal.aborted) {
        throw new RequestAbortedError();
      }
      const row = await this.transport.poll(serial);
      if (row !== null && TERMINAL_STATUSES.has(row.status)) {
        return row;
      }
      if (Date.now() >= deadline) {
        throw new SendTimeoutError();
      }
      await sleep(this.resultPollMs, signal);
    }
  }
}

/** Extract `wa_message_id` from a worker result row (jsonb). */
function extractWaMessageId(result: unknown): string | null {
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    return null;
  }
  const waMessageId = (result as Record<string, unknown>).wa_message_id;
  return typeof waMessageId === "string" && waMessageId !== "" ? waMessageId : null;
}

/** Timer-based sleep that short-circuits on request abort. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal !== undefined && signal.aborted) {
      reject(new RequestAbortedError());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new RequestAbortedError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Compile-time assertion (Go convention): SendMessageService implements SendMessagePort. */
const _: SendMessagePort = undefined as unknown as SendMessageService;
