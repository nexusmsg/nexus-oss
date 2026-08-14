"use client";

/* ── API keys list hook ──
 *
 * `useApiKeys` loads the API-key management list and exposes manual `refresh`,
 * `create`, `update`, and `revoke` helpers. Every mutation refreshes the list
 * afterwards so the table always reflects server state.
 *
 * All network access goes through the typed api-keys module
 * (`src/lib/api/api-keys.ts`), which uses the shared client's `apiGet` /
 * `apiPost` / `apiPatch` / `apiDelete` and normalizes failures into `ApiError`.
 * Types come from `src/lib/api/types.ts`.
 *
 * Redaction contract: only `create` returns the plaintext `secret` (one-time)
 * and `reveal` fetches it on demand (authenticated). `list`, `update`, and
 * `revoke` operate on redacted records. `reveal` does not mutate list state.
 *
 * State updates after unmount are guarded via `mountedRef`; a pending mutation
 * whose continuation resolves after unmount stops before touching state.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createApiKey,
  listApiKeys,
  revealApiKeySecret,
  revokeApiKey,
  updateApiKey,
} from "@/lib/api/api-keys";
import type {
  ApiKey,
  CreateApiKeyInput,
  CreateApiKeyResult,
  UpdateApiKeyInput,
} from "@/lib/api/types";

/* Convenience re-export so hook consumers can import the key types here. */
export type {
  ApiKey,
  CreateApiKeyInput,
  CreateApiKeyResult,
  UpdateApiKeyInput,
} from "@/lib/api/types";

export interface UseApiKeysReturn {
  keys: ApiKey[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  create: (input: CreateApiKeyInput) => Promise<CreateApiKeyResult>;
  update: (serial: string, input: UpdateApiKeyInput) => Promise<ApiKey>;
  revoke: (serial: string) => Promise<void>;
  reveal: (serial: string) => Promise<string>;
}

export function useApiKeys(): UseApiKeysReturn {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    // Guarded: mutation continuations may resolve after unmount.
    if (!mountedRef.current) return;
    setError(null);
    try {
      const data = await listApiKeys();
      if (mountedRef.current) {
        setKeys(data);
        setLoading(false);
      }
    } catch (e) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : "Failed to load API keys");
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
    async (input: CreateApiKeyInput): Promise<CreateApiKeyResult> => {
      const result = await createApiKey(input);
      await refresh();
      return result;
    },
    [refresh],
  );

  const update = useCallback(
    async (serial: string, input: UpdateApiKeyInput): Promise<ApiKey> => {
      const key = await updateApiKey(serial, input);
      await refresh();
      return key;
    },
    [refresh],
  );

  const revoke = useCallback(
    async (serial: string): Promise<void> => {
      await revokeApiKey(serial);
      await refresh();
    },
    [refresh],
  );

  // Reveal is read-only: it does not mutate list state, so no refresh. A failed
  // reveal rejects with the ApiError message; the caller UI handles display.
  const reveal = useCallback(
    async (serial: string): Promise<string> => {
      return revealApiKeySecret(serial);
    },
    [],
  );

  return { keys, loading, error, refresh, create, update, revoke, reveal };
}
