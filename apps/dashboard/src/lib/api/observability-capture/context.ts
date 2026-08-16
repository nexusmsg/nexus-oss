import type { ActivityContext } from "../domain/observability";

/**
 * Create the activity context handed to wrapped handlers. The handler reports
 * an enqueued `job_serial` via `setJobSerial`; `obs`/`record` read `jobSerial`
 * after the handler returns and attach it to the recorded activity row.
 */
export function makeActivityContext(): ActivityContext {
  let reported: string | null = null;
  return {
    setJobSerial(serial: string): void {
      reported = serial;
    },
    get jobSerial(): string | null {
      return reported;
    },
  };
}