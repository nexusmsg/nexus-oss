import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useApiKeys } from "./useApiKeys";
import { ApiError } from "@/lib/api/types";
import type { ApiKey } from "@/lib/api/types";

vi.mock("@/lib/api/api-keys", () => ({
  listApiKeys: vi.fn(),
  createApiKey: vi.fn(),
  updateApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
}));

import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  updateApiKey,
} from "@/lib/api/api-keys";

const mockedList = vi.mocked(listApiKeys);
const mockedCreate = vi.mocked(createApiKey);
const mockedUpdate = vi.mocked(updateApiKey);
const mockedRevoke = vi.mocked(revokeApiKey);

function makeKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    serial: "key_1",
    name: "Production",
    key_prefix: "waba_prod_…",
    scope: "full",
    status: "active",
    expires_at: null,
    last_used_at: null,
    created_at: "2026-08-10T00:00:00.000Z",
    updated_at: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("useApiKeys", () => {
  it("loads keys on mount and clears loading", async () => {
    mockedList.mockResolvedValue([makeKey()]);

    const { result } = renderHook(() => useApiKeys());
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.keys).toEqual([makeKey()]);
    expect(result.current.error).toBeNull();
  });

  it("refresh() re-fetches the list", async () => {
    mockedList.mockResolvedValue([makeKey()]);

    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.keys).toHaveLength(1);

    mockedList.mockResolvedValue([makeKey(), makeKey({ serial: "key_2" })]);
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.keys).toHaveLength(2);
    expect(mockedList).toHaveBeenCalledTimes(2);
  });

  it("surfaces list errors as a message", async () => {
    mockedList.mockRejectedValue(new ApiError(500, "boom"));

    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.keys).toEqual([]);
    expect(result.current.error).toContain("boom");
  });

  it("keeps stale keys on a failed refresh", async () => {
    mockedList.mockResolvedValue([makeKey()]);

    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => expect(result.current.keys).toHaveLength(1));

    mockedList.mockRejectedValue(new Error("network down"));
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.keys).toHaveLength(1);
    expect(result.current.error).toContain("network down");
  });

  it("create() returns the one-time result and refreshes the list", async () => {
    const key = makeKey();
    const created = { key, secret: "waba_prod_secret" };
    mockedCreate.mockResolvedValue(created);
    mockedList.mockResolvedValue([key]);

    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let output: { key: ApiKey; secret: string } | undefined;
    await act(async () => {
      output = await result.current.create({ name: "Production", scope: "full" });
    });

    expect(output).toEqual(created);
    expect(mockedCreate).toHaveBeenCalledWith({ name: "Production", scope: "full" });
    expect(mockedList).toHaveBeenCalledTimes(2);
  });

  it("update() updates a key and refreshes the list", async () => {
    const key = makeKey({ name: "Renamed" });
    mockedUpdate.mockResolvedValue(key);
    mockedList.mockResolvedValue([key]);

    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let output: ApiKey | undefined;
    await act(async () => {
      output = await result.current.update("key_1", { name: "Renamed" });
    });

    expect(output).toEqual(key);
    expect(mockedUpdate).toHaveBeenCalledWith("key_1", { name: "Renamed" });
    expect(mockedList).toHaveBeenCalledTimes(2);
  });

  it("revoke() revokes a key and refreshes the list", async () => {
    const key = makeKey();
    mockedList.mockResolvedValue([key]);

    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.revoke("key_1");
    });

    expect(mockedRevoke).toHaveBeenCalledWith("key_1");
    expect(mockedList).toHaveBeenCalledTimes(2);
  });
});
