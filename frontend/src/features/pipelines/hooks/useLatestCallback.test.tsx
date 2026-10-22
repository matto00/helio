import { renderHook } from "@testing-library/react";

import { useLatestCallback } from "./useLatestCallback";

describe("useLatestCallback", () => {
  it("keeps one identity across renders and calls the latest closure", () => {
    const first = jest.fn(() => "first");
    const second = jest.fn(() => "second");
    const { result, rerender } = renderHook(({ fn }) => useLatestCallback(fn), {
      initialProps: { fn: first },
    });
    const stable = result.current;

    rerender({ fn: second });

    expect(result.current).toBe(stable);
    expect(stable()).toBe("second");
    expect(first).not.toHaveBeenCalled();
  });

  it("passes arguments and the return value through", () => {
    const { result } = renderHook(() => useLatestCallback((a: number, b: number) => a + b));
    expect(result.current(2, 3)).toBe(5);
  });
});
