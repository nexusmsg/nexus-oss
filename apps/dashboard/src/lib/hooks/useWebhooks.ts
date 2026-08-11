"use client";

/* ── Webhooks list hook ──
 *
 * `useWebhooks` loads the webhook config list and exposes manual `refresh`,
 * `create`, `update`, `remove`, and `toggleEnabled` helpers. Every mutation
 * refreshes the list afterwards so the table always reflects server state.
 *
 * All network access goes through the typed webhook module
 * (`src/lib/api/webhooks.ts`), which uses the shared client's `apiGet` /
 * `apiPost` / `apiPatch` / `apiDelete` and normalizes failures into `ApiError`.
 * Types come from `src/lib/api/types.ts`.
 *
 * State updates after unmount are guarded via `mountedRef`; a pending mutation
 * whose continuation resolves after unmount stops before touching state.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createWebhook,
  deleteWebhook,
  listWebhooks,
  updateWebhook,
} from "@/lib/api/webhooks";
import type {
  CreateWebhookInput,
  UpdateWebhookInput,
  WebhookConfig,
} from "@/lib/api/types";

/* Convenience re-export so hook consumers can import the config types here. */
export type {
  CreateWebhookInput,
  UpdateWebhookInput,
  WebhookConfig,
} from "@/lib/api/types";

export interface UseWebhooksReturn {
  webhooks: WebhookConfig[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  create: (input: CreateWebhookInput) => Promise<WebhookConfig>;
  update: (serial: string, input: UpdateWebhookInput) => Promise<WebhookConfig>;
  remove: (serial: string) => Promise<void>;
  toggleEnabled: (serial: string, enabled: boolean) => Promise<WebhookConfig>;
}

export function useWebhooks(): UseWebhooksReturn {
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    // Guarded: mutation continuations may resolve after unmount.
    if (!mountedRef.current) return;
    setError(null);
    try {
      const data = await listWebhooks();
      if (mountedRef.current) {
        setWebhooks(data);
        setLoading(false);
      }
    } catch (e) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : "Failed to load webhooks");
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch, guarded by mountedRef
    void refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  const create = useCallback(
    async (input: CreateWebhookInput): Promise<WebhookConfig> => {
      const cfg = await createWebhook(input);
      await refresh();
      return cfg;
    },
    [refresh],
  );

  const update = useCallback(
    async (serial: string, input: UpdateWebhookInput): Promise<WebhookConfig> => {
      const cfg = await updateWebhook(serial, input);
      await refresh();
      return cfg;
    },
    [refresh],
  );

  const remove = useCallback(
    async (serial: string): Promise<void> => {
      await deleteWebhook(serial);
      await refresh();
    },
    [refresh],
  );

  const toggleEnabled = useCallback(
    async (serial: string, enabled: boolean): Promise<WebhookConfig> => {
      return update(serial, { enabled });
    },
    [update],
  );

  return { webhooks, loading, error, refresh, create, update, remove, toggleEnabled };
}
