import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollStatus, useSessions } from "./useSessions";
import { ApiError } from "@/lib/api/types";
import type { Session } from "@/lib/api/types";

vi.mock("@/lib/api/sessions", () => ({
  listSessions: vi.fn(),
  getSessionStatus: vi.fn(),
}));

import { getSessionStatus, listSessions } from "@/lib/api/sessions";

const mockedList = vi.mocked(listSessions);
const mockedStatus = vi.mocked(getSessionStatus);

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "ses_1",
    phone_number_id: "123",
    number: "+15550001000",
    display_phone: null,
    business_account_id: null,
    status: "created",
    whatsapp_id: null,
    connected_at: null,
    last_seen_at: null,
    logged_out_at: null,
    created_at: "2026-08-10T00:00:00.000Z",
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

describe("useSessions", () => {
  it("loads sessions on mount and clears loading", async () => {
    mockedList.mockResolvedValue([makeSession()]);

    const { result } = renderHook(() => useSessions());
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sessions).toEqual([makeSession()]);
    expect(result.current.error).toBeNull();
  });

  it("refresh() re-fetches the list", async () => {
    mockedList.mockResolvedValue([makeSession()]);

    const { result } = renderHook(() => useSessions());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sessions).toHaveLength(1);

    mockedList.mockResolvedValue([makeSession(), makeSession({ id: "ses_2" })]);
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.sessions).toHaveLength(2);
    expect(mockedList).toHaveBeenCalledTimes(2);
  });

  it("surfaces list errors as a message", async () => {
    mockedList.mockRejectedValue(new ApiError(500, "boom"));

    const { result } = renderHook(() => useSessions());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.sessions).toEqual([]);
    expect(result.current.error).toContain("boom");
  });

  it("keeps stale sessions on a failed refresh", async () => {
    mockedList.mockResolvedValue([makeSession()]);

    const { result } = renderHook(() => useSessions());
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));

    mockedList.mockRejectedValue(new Error("network down"));
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.error).toContain("network down");
  });
});

describe("pollStatus", () => {
  it("resolves immediately when the target status is already reached", async () => {
    mockedStatus.mockResolvedValue("logged_out");

    await expect(pollStatus("ses_1", "logged_out", 1000)).resolves.toBe("logged_out");
    expect(mockedStatus).toHaveBeenCalledWith("ses_1");
  });

  it("keeps polling until the target status arrives", async () => {
    vi.useFakeTimers();
    mockedStatus
      .mockResolvedValueOnce("connected")
      .mockResolvedValueOnce("connected")
      .mockResolvedValueOnce("logged_out");

    const pending = pollStatus("ses_1", "logged_out", 10000);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    await expect(pending).resolves.toBe("logged_out");
    expect(mockedStatus).toHaveBeenCalledTimes(3);
  });

  it("rejects with ApiError when the deadline passes", async () => {
    vi.useFakeTimers();
    mockedStatus.mockResolvedValue("connected"); // never reaches target

    const pending = pollStatus("ses_1", "logged_out", 2500);
    // Handle the rejection eagerly so Node doesn't flag it before `.rejects`
    // is attached (the deadline fires mid-advance).
    pending.catch(() => undefined);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });

    await expect(pending).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining("logged_out"),
    });
  });

  it("keeps polling through transient request errors until the deadline", async () => {
    vi.useFakeTimers();
    mockedStatus
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce("connected")
      .mockResolvedValueOnce("logged_out");

    const pending = pollStatus("ses_1", "logged_out", 10000);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    await expect(pending).resolves.toBe("logged_out");
    expect(mockedStatus).toHaveBeenCalledTimes(3);
  });

  it("rejects immediately with AbortError when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      pollStatus("ses_1", "connected", 1000, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mockedStatus).not.toHaveBeenCalled();
  });

  it("threads the AbortSignal into every status fetch", async () => {
    vi.useFakeTimers();
    mockedStatus.mockResolvedValue("connected"); // target reached on first poll

    const controller = new AbortController();
    await expect(
      pollStatus("ses_1", "connected", 10000, controller.signal),
    ).resolves.toBe("connected");
    expect(mockedStatus).toHaveBeenCalledWith("ses_1", {
      signal: controller.signal,
    });
  });

  it("stops polling and rejects with AbortError when aborted mid-poll", async () => {
    vi.useFakeTimers();
    mockedStatus.mockResolvedValue("pairing"); // never reaches target

    const controller = new AbortController();
    const pending = pollStatus("ses_1", "connected", 10000, controller.signal);
    pending.catch(() => undefined);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    const pollsBefore = mockedStatus.mock.calls.length;
    expect(pollsBefore).toBeGreaterThanOrEqual(1);

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(mockedStatus.mock.calls.length).toBe(pollsBefore);
  });

  it("aborting during a pending sleep wakes promptly without waiting the interval", async () => {
    vi.useFakeTimers();
    mockedStatus.mockResolvedValue("pairing");

    const controller = new AbortController();
    const pending = pollStatus("ses_1", "connected", 10000, controller.signal);
    pending.catch(() => undefined);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0); // first fetch resolves → sleep starts
    });
    const pollsBefore = mockedStatus.mock.calls.length;

    // No timer advance — the abort alone must reject the pending sleep.
    controller.abort();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(mockedStatus.mock.calls.length).toBe(pollsBefore);
  });

  it("abort wins over transient request errors (no retry after abort)", async () => {
    vi.useFakeTimers();
    mockedStatus.mockRejectedValueOnce(new Error("network down"));

    const controller = new AbortController();
    const pending = pollStatus("ses_1", "connected", 10000, controller.signal);
    pending.catch(() => undefined);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0); // first fetch rejects → sleep starts
    });
    const pollsBefore = mockedStatus.mock.calls.length;

    controller.abort();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(mockedStatus.mock.calls.length).toBe(pollsBefore);
  });
});
