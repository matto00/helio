import { act, renderHook } from "@testing-library/react";

import { MAX_WAIT_MS, QUIET_MS, useIdleCoalesced } from "./useIdleCoalesced";

function render() {
  const seen: number[] = [];
  const hook = renderHook(
    ({ v }) => {
      const shown = useIdleCoalesced(v);
      if (seen.at(-1) !== shown) seen.push(shown);
      return shown;
    },
    { initialProps: { v: 0 } },
  );
  return { ...hook, seen };
}

describe("useIdleCoalesced", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    // @ts-expect-error test seam
    delete window.requestIdleCallback;
    // @ts-expect-error test seam
    delete window.cancelIdleCallback;
  });

  it("shows the first value at once", () => {
    expect(render().result.current).toBe(0);
  });

  it("shows nothing while edits keep arriving, then one render of the latest value once quiet", () => {
    const { result, rerender, seen } = render();
    for (let v = 1; v <= 10; v += 1) {
      rerender({ v });
      act(() => {
        jest.advanceTimersByTime(QUIET_MS / 5);
      });
      expect(result.current).toBe(0);
    }
    act(() => {
      jest.advanceTimersByTime(QUIET_MS);
    });
    expect(result.current).toBe(10);
    expect(seen).toEqual([0, 10]);
  });

  it("still updates now and then during an unbroken stream of changes", () => {
    jest.setSystemTime(0);
    const { result, rerender } = render();
    let v = 0;
    for (let t = 0; t <= MAX_WAIT_MS + QUIET_MS; t += QUIET_MS - 20) {
      v += 1;
      rerender({ v });
      act(() => {
        jest.advanceTimersByTime(QUIET_MS - 20);
      });
    }
    expect(result.current).toBeGreaterThan(0);
  });

  it("waits for an idle moment once quiet, using requestIdleCallback when there is one", () => {
    const callbacks = new Map<number, () => void>();
    let next = 1;
    window.requestIdleCallback = ((cb: () => void) => {
      callbacks.set(next, cb);
      return next++;
    }) as never;
    window.cancelIdleCallback = ((h: number) => callbacks.delete(h)) as never;
    const { result, rerender } = render();
    rerender({ v: 5 });
    act(() => {
      jest.advanceTimersByTime(QUIET_MS + 1);
    });
    expect(result.current).toBe(0);
    expect(callbacks.size).toBe(1);
    act(() => callbacks.forEach((cb) => cb()));
    expect(result.current).toBe(5);
  });
});
