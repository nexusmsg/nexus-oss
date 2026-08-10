/**
 * Input port: synchronous WABA message send (enqueue + poll until terminal).
 * The HTTP adapter depends on this; the SendMessageService implements it.
 */

export interface SendMessageInput {
  phoneNumberId: string;
  /** WABA message payload persisted on the job row. */
  payload: unknown;
  idempotencyKey?: string;
  /** Abort the poll-wait when the request is cancelled. */
  signal?: AbortSignal;
}

export type SendMessageResult =
  | { status: "succeeded"; wamid: string }
  | { status: "failed"; reason: string };

export interface SendMessagePort {
  send(input: SendMessageInput): Promise<SendMessageResult>;
}
