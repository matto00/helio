import { createInFlightDedupe } from "./inFlightDedupe";
import { usePendingStepSaves } from "./stepSaveContext";
import { renderHook } from "@testing-library/react";

describe("createInFlightDedupe (HEL-1579 design.md D8)", () => {
  it("joins a second request for a key whose request is still in flight", async () => {
    const dedupe = createInFlightDedupe();
    let resolve!: (v: number) => void;
    const start = jest.fn(() => new Promise<number>((r) => (resolve = r)));
    const a = dedupe.run("s1:fp", start);
    const b = dedupe.run("s1:fp", start);
    expect(start).toHaveBeenCalledTimes(1);
    resolve(7);
    await expect(Promise.all([a, b])).resolves.toEqual([7, 7]);
  });

  it("never reuses a settled response: the next request for the same key starts fresh", async () => {
    const dedupe = createInFlightDedupe();
    const start = jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    await expect(dedupe.run("k", start)).resolves.toBe(1);
    await expect(dedupe.run("k", start)).resolves.toBe(2);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("forgets a rejected request too, and keys are independent", async () => {
    const dedupe = createInFlightDedupe();
    await expect(dedupe.run("k", () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    await expect(dedupe.run("k", () => Promise.resolve("ok"))).resolves.toBe("ok");
    const start = jest.fn(() => Promise.resolve(1));
    await Promise.all([dedupe.run("a", start), dedupe.run("b", start)]);
    expect(start).toHaveBeenCalledTimes(2);
  });
});

describe("usePendingStepSaves (HEL-1579 design.md D8)", () => {
  it("whenIdle resolves immediately with nothing pending", async () => {
    const { result } = renderHook(() => usePendingStepSaves());
    await expect(result.current.whenIdle()).resolves.toBeUndefined();
  });

  it("whenIdle waits for every registered write, including one registered while waiting", async () => {
    const { result } = renderHook(() => usePendingStepSaves());
    let resolveFirst!: () => void;
    let resolveSecond!: () => void;
    result.current.register(new Promise<void>((r) => (resolveFirst = r)));
    let idle = false;
    const waiting = result.current.whenIdle().then(() => {
      idle = true;
    });
    result.current.register(new Promise<void>((r) => (resolveSecond = r)));
    resolveFirst();
    await Promise.resolve();
    await Promise.resolve();
    expect(idle).toBe(false);
    resolveSecond();
    await waiting;
    expect(idle).toBe(true);
  });

  it("a rejected write still lets whenIdle resolve (the tracker never rejects on its behalf)", async () => {
    const { result } = renderHook(() => usePendingStepSaves());
    result.current.register(Promise.reject(new Error("422")));
    await expect(result.current.whenIdle()).resolves.toBeUndefined();
  });
});
