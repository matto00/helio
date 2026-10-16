import { createLimiter, limitApi } from "./requestLimiter.js";
import type { HelioApi } from "./helioApi.js";

const tick = (ms = 1) => new Promise((r) => setTimeout(r, ms));

describe("createLimiter (HEL-1619 D8)", () => {
  it("never runs more than max at once, and starts queued work in FIFO order", async () => {
    const limit = createLimiter(3);
    let active = 0;
    let peak = 0;
    const started: number[] = [];
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        limit(async () => {
          started.push(i);
          active++;
          peak = Math.max(peak, active);
          await tick(2);
          active--;
        }),
      ),
    );
    expect(peak).toBe(3);
    expect(started).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it("a new call arriving as a slot frees cannot exceed max (slot hand-off)", async () => {
    const limit = createLimiter(1);
    let active = 0;
    let peak = 0;
    const work = async () => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
    };
    const first = limit(work);
    const second = limit(work);
    // arrives after `first` finished but before `second` resumed
    await first;
    const third = limit(work);
    await Promise.all([second, third]);
    expect(peak).toBe(1);
  });

  it("propagates rejections and releases the slot", async () => {
    const limit = createLimiter(1);
    await expect(limit(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(limit(async () => 7)).resolves.toBe(7);
  });

  it("does not deadlock when a task awaits a deduped limited call queued behind it (cap 1)", async () => {
    const limit = createLimiter(1);
    // models the panel-controls lookup: one shared snapshot promise awaited by every placement task
    const api = limitApi(
      { snapshot: async () => "snap", placements: async () => ["x"] } as unknown as HelioApi,
      limit,
    ) as unknown as { snapshot: () => Promise<string>; placements: () => Promise<string[]> };
    let shared: Promise<string> | undefined;
    const task = async () => {
      await api.placements();
      shared ??= api.snapshot();
      return await shared;
    };
    const results = await Promise.race([
      Promise.all([task(), task(), task()]),
      tick(500).then(() => "DEADLOCK"),
    ]);
    expect(results).toEqual(["snap", "snap", "snap"]);
  });

  it("rejects a non-positive max", () => {
    expect(() => createLimiter(0)).toThrow();
  });
});

describe("limitApi", () => {
  it("routes method calls through the limiter with the right this, and passes non-functions through", async () => {
    let calls = 0;
    const limit = ((fn: () => Promise<unknown>) => {
      calls++;
      return fn();
    }) as never;
    class Fake {
      v = 41;
      add(n: number) {
        return Promise.resolve(this.v + n);
      }
    }
    const wrapped = limitApi(new Fake() as unknown as HelioApi, limit) as unknown as Fake;
    expect(await wrapped.add(1)).toBe(42);
    expect(calls).toBe(1);
    expect(wrapped.v).toBe(41);
  });
});
