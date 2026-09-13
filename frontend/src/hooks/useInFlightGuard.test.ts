import { act, renderHook } from "@testing-library/react";

import { useInFlightGuard } from "./useInFlightGuard";

/** A promise plus externally-callable resolve/reject, for controlling exactly
 *  when a `guardedRun` call's `fn` settles. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useInFlightGuard", () => {
  it("invokes fn once when two synchronous guardedRun calls share a key in the same tick", () => {
    const { result } = renderHook(() => useInFlightGuard<string>());
    const fn = jest.fn(() => new Promise<void>(() => {}));

    act(() => {
      result.current.guardedRun("a", fn);
      result.current.guardedRun("a", fn);
    });

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("treats calls with different keys as independent", () => {
    const { result } = renderHook(() => useInFlightGuard<string>());
    const fnA = jest.fn(() => new Promise<void>(() => {}));
    const fnB = jest.fn(() => new Promise<void>(() => {}));

    act(() => {
      result.current.guardedRun("a", fnA);
      result.current.guardedRun("b", fnB);
    });

    expect(fnA).toHaveBeenCalledTimes(1);
    expect(fnB).toHaveBeenCalledTimes(1);
    expect(result.current.isPending("a")).toBe(true);
    expect(result.current.isPending("b")).toBe(true);
  });

  it("clears isPending after a resolved fn promise", async () => {
    const { result } = renderHook(() => useInFlightGuard<string>());
    const { promise, resolve } = deferred<void>();

    act(() => {
      result.current.guardedRun("a", () => promise);
    });
    expect(result.current.isPending("a")).toBe(true);

    await act(async () => {
      resolve();
      await promise;
    });

    expect(result.current.isPending("a")).toBe(false);
  });

  it("clears isPending after a rejected fn promise, with no unhandled-rejection warning", async () => {
    const unhandled = jest.fn();
    process.on("unhandledRejection", unhandled);

    const { result } = renderHook(() => useInFlightGuard<string>());
    const { promise, reject } = deferred<void>();
    // Attach a rejection handler up front so Node's own unhandled-rejection
    // detection (which fires at the end of the microtask queue, not
    // synchronously on `.reject()`) never sees this promise as unhandled --
    // this mirrors what `guardedRun`'s internal `.catch(() => {})` guarantees
    // for the ref/state cleanup chain itself.
    promise.catch(() => {});

    act(() => {
      result.current.guardedRun("a", () => promise);
    });
    expect(result.current.isPending("a")).toBe(true);

    await act(async () => {
      reject(new Error("boom"));
      await promise.catch(() => {});
      // Flush the guard's own `.catch().finally()` chain.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.isPending("a")).toBe(false);
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("a second guardedRun call after the first settles issues a new call", async () => {
    const { result } = renderHook(() => useInFlightGuard<string>());
    const { promise, resolve } = deferred<void>();
    const fn = jest.fn(() => promise);

    act(() => {
      result.current.guardedRun("a", fn);
    });

    await act(async () => {
      resolve();
      await promise;
    });

    act(() => {
      result.current.guardedRun("a", fn);
    });

    expect(fn).toHaveBeenCalledTimes(2);
  });
});
