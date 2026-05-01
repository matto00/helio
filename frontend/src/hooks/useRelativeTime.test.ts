import { act, renderHook } from "@testing-library/react";

import { useRelativeTime } from "./useRelativeTime";

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("useRelativeTime", () => {
  it("returns empty string when timestamp is null", () => {
    const { result } = renderHook(() => useRelativeTime(null));
    expect(result.current).toBe("");
  });

  it("returns 'just now' for timestamps less than 10 seconds ago", () => {
    const now = Date.now();
    jest.setSystemTime(now);
    const { result } = renderHook(() => useRelativeTime(now - 5_000));
    expect(result.current).toBe("just now");
  });

  it("returns seconds ago for timestamps 10–59 seconds ago", () => {
    const now = Date.now();
    jest.setSystemTime(now);
    const { result } = renderHook(() => useRelativeTime(now - 45_000));
    expect(result.current).toBe("45s ago");
  });

  it("returns minutes ago for timestamps 60+ seconds ago", () => {
    const now = Date.now();
    jest.setSystemTime(now);
    const { result } = renderHook(() => useRelativeTime(now - 90_000));
    expect(result.current).toBe("1m ago");
  });

  it("updates label after 10 seconds via the tick interval", () => {
    const base = Date.now();
    jest.setSystemTime(base);
    // timestamp is 5s ago — renders "just now"
    const { result } = renderHook(() => useRelativeTime(base - 5_000));
    expect(result.current).toBe("just now");

    // Advance 10 s: now the timestamp is 15s ago → "15s ago"
    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(result.current).toBe("15s ago");
  });

  it("cleans up the interval on unmount without errors", () => {
    const { unmount } = renderHook(() => useRelativeTime(Date.now()));
    expect(() => unmount()).not.toThrow();
  });
});
