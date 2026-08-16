/** Summarize a thrown value for the recorded `error` payload field (≤ 500 chars). */
export function summarizeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message.length > 500 ? `${err.message.slice(0, 500)}…` : err.message;
  }
  try {
    return JSON.stringify(err).slice(0, 500);
  } catch {
    return "unknown error";
  }
}