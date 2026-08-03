import { describe, expect, it } from "vitest";
import { RequestAbortedError, SendTimeoutError } from "../domain/errors.js";
import type { WebhookConfig } from "../domain/webhook-config.js";
import type { EnqueueInput, JobTransport, PollResult } from "../ports/job-transport.js";
import { SendMessageService } from "./send-message.js";

class FakeJobTransport implements JobTransport {
  enqueueCalls: EnqueueInput[] = [];
  pollCalls: string[] = [];

  constructor(
    private readonly opts: {
      pollResult?: PollResult | null;
      pollBehavior?: () => PollResult | null;
    } = {},
  ) {}

  async enqueue(input: EnqueueInput): Promise<string> {
    this.enqueueCalls.push(input);
    return "serial-1";
  }

  async poll(serial: string): Promise<PollResult | null> {
    this.pollCalls.push(serial);
    if (this.opts.pollBehavior !== undefined) {
      return this.opts.pollBehavior();
    }
    return (
      this.opts.pollResult ?? {
        status: "succeeded",
        result: { wa_message_id: "wamid.abc" },
        lastError: null,
      }
    );
  }

  async getWebhookConfig(_phoneNumberId: string): Promise<WebhookConfig | null> {
    return null;
  }
}

function makeService(
  transport: JobTransport,
  overrides: { sendTimeoutMs?: number; resultPollMs?: number } = {},
): SendMessageService {
  return new SendMessageService({
    transport,
    sendTimeoutMs: overrides.sendTimeoutMs ?? 1000,
    resultPollMs: overrides.resultPollMs ?? 5,
  });
}

describe("SendMessageService.send", () => {
  it("maps a succeeded poll to a wamid result", async () => {
    const transport = new FakeJobTransport();
    const service = makeService(transport);

    const result = await service.send({ phoneNumberId: "12345", payload: { to: "628" } });

    expect(result).toEqual({ status: "succeeded", wamid: "wamid.abc" });
  });

  it("maps a failed poll to a reason result", async () => {
    const transport = new FakeJobTransport({
      pollResult: { status: "failed", result: null, lastError: "recipient not on WhatsApp" },
    });
    const service = makeService(transport);

    await expect(
      service.send({ phoneNumberId: "12345", payload: {} }),
    ).resolves.toEqual({ status: "failed", reason: "recipient not on WhatsApp" });
  });

  it("uses the default reason when the failed poll has no last_error", async () => {
    const transport = new FakeJobTransport({
      pollResult: { status: "failed", result: null, lastError: null },
    });
    const service = makeService(transport);

    await expect(service.send({ phoneNumberId: "12345", payload: {} })).resolves.toEqual({
      status: "failed",
      reason: "Unable to send message",
    });
  });

  it("surfaces an internal error when the job succeeded without a wa_message_id", async () => {
    const transport = new FakeJobTransport({
      pollResult: { status: "succeeded", result: {}, lastError: null },
    });
    const service = makeService(transport);

    await expect(service.send({ phoneNumberId: "12345", payload: {} })).resolves.toEqual({
      status: "failed",
      reason: "Internal server error",
    });
  });

  it("passes payload and idempotency key through to enqueue", async () => {
    const transport = new FakeJobTransport();
    const service = makeService(transport);

    const result = await service.send({
      phoneNumberId: "12345",
      payload: { to: "628", text: { body: "hi" } },
      idempotencyKey: "k-1",
    });

    expect(result).toEqual({ status: "succeeded", wamid: "wamid.abc" });
    expect(transport.enqueueCalls).toEqual([
      { phoneNumberId: "12345", payload: { to: "628", text: { body: "hi" } }, idempotencyKey: "k-1" },
    ]);
    expect(transport.pollCalls).toEqual(["serial-1"]);
  });

  it("throws SendTimeoutError when the job never reaches a terminal state", async () => {
    const transport = new FakeJobTransport({
      pollBehavior: () => ({ status: "pending", result: null, lastError: null }),
    });
    const service = makeService(transport, { sendTimeoutMs: 20, resultPollMs: 5 });

    await expect(service.send({ phoneNumberId: "12345", payload: {} })).rejects.toBeInstanceOf(
      SendTimeoutError,
    );
    expect(transport.pollCalls.length).toBeGreaterThan(1);
  });

  it("throws an abort error when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const transport = new FakeJobTransport();
    const service = makeService(transport);

    await expect(
      service.send({ phoneNumberId: "12345", payload: {}, signal: controller.signal }),
    ).rejects.toBeInstanceOf(RequestAbortedError);
  });

  it("throws an abort error when the signal fires during the poll sleep", async () => {
    const controller = new AbortController();
    const transport = new FakeJobTransport({
      pollBehavior: () => ({ status: "pending", result: null, lastError: null }),
    });
    const service = makeService(transport, { sendTimeoutMs: 1000, resultPollMs: 20 });

    const promise = service.send({ phoneNumberId: "12345", payload: {}, signal: controller.signal });
    setTimeout(() => controller.abort(), 5);

    await expect(promise).rejects.toBeInstanceOf(RequestAbortedError);
  });
});
