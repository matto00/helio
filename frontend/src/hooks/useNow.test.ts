import { act, renderHook } from "@testing-library/react";

import { resetUseNowForTests, useNow } from "./useNow";

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
  resetUseNowForTests();
  jest.useRealTimers();
});

describe("useNow", () => {
  it("keeps a stable value across re-renders and between ticks", () => {
    const { result, rerender } = renderHook(() => useNow(60_000));
    const first = result.current;
    jest.setSystemTime(Date.now() + 20_000);
    rerender();
    rerender();
    expect(result.current).toBe(first);
  });

  it("updates every consumer together on the tick", () => {
    const a = renderHook(() => useNow(60_000));
    const b = renderHook(() => useNow(60_000));
    const first = a.result.current;
    expect(b.result.current).toBe(first);
    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(a.result.current).toBe(first + 60_000);
    expect(b.result.current).toBe(a.result.current);
  });

  it("runs one interval for many consumers and stops it after the last unmount", () => {
    const a = renderHook(() => useNow(60_000));
    const b = renderHook(() => useNow(60_000));
    expect(jest.getTimerCount()).toBe(1);
    a.unmount();
    expect(jest.getTimerCount()).toBe(1);
    b.unmount();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("gives a current value to a consumer mounting after ten idle minutes", () => {
    const first = renderHook(() => useNow(60_000));
    const initial = first.result.current;
    first.unmount();
    jest.setSystemTime(Date.now() + 10 * 60_000);
    const second = renderHook(() => useNow(60_000));
    expect(second.result.current).toBe(initial + 10 * 60_000);
  });

  it("keeps ticking across re-renders: a re-render alone neither changes now nor restarts the interval", () => {
    const { result, rerender } = renderHook(() => useNow(60_000));
    const first = result.current;
    act(() => {
      jest.advanceTimersByTime(50_000);
    });
    rerender();
    expect(result.current).toBe(first);
    act(() => {
      jest.advanceTimersByTime(20_000);
    });
    expect(result.current).toBe(first + 70_000 - 10_000);
    expect(result.current).not.toBe(first);
  });
});
