import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePairingQr } from "./usePairingQr";
import type { PairingQr } from "@/lib/api/types";

vi.mock("@/lib/api/sessions", () => ({
  requestPairing: vi.fn(),
  getPairingQr: vi.fn(),
}));

import { getPairingQr, requestPairing } from "@/lib/api/sessions";

const mockedPairing = vi.mocked(requestPairing);
const mockedQr = vi.mocked(getPairingQr);

const NOT_FOUND: PairingQr = {
  status: "not_found",
  qr_code: null,
  qr_serial: null,
  expires_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("usePairingQr", () => {
  it("starts in generating, issues pairing, then polls to ready", async () => {
    vi.useFakeTimers();
    mockedPairing.mockResolvedValue({ job_serial: "job_1" });
    mockedQr
      .mockResolvedValueOnce(NOT_FOUND)
      .mockResolvedValueOnce({
        status: "ready",
        qr_code: "qr-data",
        qr_serial: "qr_1",
        expires_at: "2026-08-11T00:00:00Z",
      });

    const { result } = renderHook(() =>
      usePairingQr({ intervalMs: 1000, timeoutMs: 60000 }),
    );
    expect(result.current.phase).toBe("generating");

    await act(async () => {
      void result.current.start("ses_1");
      await vi.advanceTimersByTimeAsync(0);
    });
    // First poll returned not_found → still generating.
    expect(result.current.phase).toBe("generating");
    expect(result.current.jobSerial).toBe("job_1");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.phase).toBe("ready");
    expect(result.current.qrCode).toBe("qr-data");
    expect(mockedPairing).toHaveBeenCalledTimes(1);
    expect(mockedPairing).toHaveBeenCalledWith("ses_1");
    // The serial from POST is threaded into the GET filter so the dashboard
    // never reads a QR produced by a different pairing job.
    expect(mockedQr).toHaveBeenCalledWith(
      "ses_1",
      expect.objectContaining({ jobSerial: "job_1" }),
    );
  });

  it("flips to expired when the QR never arrives before the deadline", async () => {
    vi.useFakeTimers();
    mockedPairing.mockResolvedValue({ job_serial: "job_1" });
    mockedQr.mockResolvedValue(NOT_FOUND);

    const { result } = renderHook(() =>
      usePairingQr({ intervalMs: 1000, timeoutMs: 2500 }),
    );

    await act(async () => {
      void result.current.start("ses_1");
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.phase).toBe("generating");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(result.current.phase).toBe("expired");
    expect(result.current.qrCode).toBeNull();
  });

  it("flips to expired when the worker reports an expired QR", async () => {
    vi.useFakeTimers();
    mockedPairing.mockResolvedValue({ job_serial: "job_1" });
    mockedQr.mockResolvedValueOnce(NOT_FOUND).mockResolvedValueOnce({
      status: "expired",
      qr_code: null,
      qr_serial: null,
      expires_at: null,
    });

    const { result } = renderHook(() =>
      usePairingQr({ intervalMs: 1000, timeoutMs: 60000 }),
    );

    await act(async () => {
      void result.current.start("ses_1");
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.phase).toBe("expired");
  });

  it("flips to error when the worker reports the pairing job failed", async () => {
    vi.useFakeTimers();
    mockedPairing.mockResolvedValue({ job_serial: "job_1" });
    mockedQr.mockResolvedValueOnce({
      ...NOT_FOUND,
      job_serial: "job_1",
      job_status: "failed",
    });

    const { result } = renderHook(() =>
      usePairingQr({ intervalMs: 1000, timeoutMs: 60000 }),
    );

    await act(async () => {
      void result.current.start("ses_1");
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.phase).toBe("error");
    expect(result.current.error).toContain("Pairing job failed");
  });

  it("keeps polling while job_status is pending even without a QR row yet", async () => {
    vi.useFakeTimers();
    mockedPairing.mockResolvedValue({ job_serial: "job_1" });
    mockedQr.mockResolvedValue({
      status: "not_found",
      qr_code: null,
      qr_serial: null,
      expires_at: null,
      job_serial: "job_1",
      job_status: "pending",
    });

    const { result } = renderHook(() =>
      usePairingQr({ intervalMs: 1000, timeoutMs: 60000 }),
    );

    await act(async () => {
      void result.current.start("ses_1");
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.phase).toBe("generating");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(result.current.phase).toBe("generating");
    expect(mockedQr.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("surfaces pairing failures as the error phase", async () => {
    vi.useFakeTimers();
    mockedPairing.mockRejectedValue(new Error("pairing boom"));

    const { result } = renderHook(() =>
      usePairingQr({ intervalMs: 1000, timeoutMs: 60000 }),
    );

    await act(async () => {
      void result.current.start("ses_1");
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.phase).toBe("error");
    expect(result.current.error).toContain("pairing boom");
    expect(mockedQr).not.toHaveBeenCalled();
  });

  it("refresh() re-issues pairing and resets the poll", async () => {
    vi.useFakeTimers();
    mockedPairing.mockResolvedValueOnce({ job_serial: "job_1" });
    mockedPairing.mockResolvedValueOnce({ job_serial: "job_2" });
    mockedQr.mockResolvedValue(NOT_FOUND);

    const { result } = renderHook(() =>
      usePairingQr({ intervalMs: 1000, timeoutMs: 60000 }),
    );
    await act(async () => {
      void result.current.start("ses_1");
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockedPairing).toHaveBeenCalledTimes(1);
    expect(result.current.jobSerial).toBe("job_1");

    mockedQr.mockResolvedValueOnce({
      status: "ready",
      qr_code: "new-qr",
      qr_serial: "qr_2",
      expires_at: "2026-08-11T00:00:00Z",
    });
    await act(async () => {
      void result.current.refresh();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockedPairing).toHaveBeenCalledTimes(2);
    expect(result.current.phase).toBe("ready");
    expect(result.current.qrCode).toBe("new-qr");
    // refresh() picks up the new serial from the second POST.
    expect(result.current.jobSerial).toBe("job_2");
  });

  it("cancel() stops polling without further QR requests", async () => {
    vi.useFakeTimers();
    mockedPairing.mockResolvedValue({ job_serial: "job_1" });
    mockedQr.mockResolvedValue(NOT_FOUND);

    const { result } = renderHook(() =>
      usePairingQr({ intervalMs: 1000, timeoutMs: 60000 }),
    );
    await act(async () => {
      void result.current.start("ses_1");
      await vi.advanceTimersByTimeAsync(0);
    });
    const pollsBefore = mockedQr.mock.calls.length;

    act(() => {
      result.current.cancel();
    });
    expect(result.current.phase).toBe("generating");
    expect(result.current.qrCode).toBeNull();
    expect(result.current.jobSerial).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mockedQr.mock.calls.length).toBe(pollsBefore);
  });

  it("tears down the poll loop on unmount", async () => {
    vi.useFakeTimers();
    mockedPairing.mockResolvedValue({ job_serial: "job_1" });
    mockedQr.mockResolvedValue(NOT_FOUND);

    const { result, unmount } = renderHook(() =>
      usePairingQr({ intervalMs: 1000, timeoutMs: 60000 }),
    );
    await act(async () => {
      void result.current.start("ses_1");
      await vi.advanceTimersByTimeAsync(0);
    });
    const pollsBefore = mockedQr.mock.calls.length;

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mockedQr.mock.calls.length).toBe(pollsBefore);
  });
});
