import { storedEntry } from "../../../../test/warmFixtures";
import { BoundedWarmStore } from "./boundedWarmStore";
import {
  WARM_ENTRY_KEYS,
  WARM_WINDOW_KEYS,
  MemoryWarmStore,
  sanitizeEntry,
  warmKey,
} from "./warmStore";
import { WARM_MAX, WARM_TTL_MS, WARM_WRITE_DEBOUNCE_MS } from "./warmConfig";
import type { WarmStore } from "./warmStore";

const NOW = 10_000_000;

function make(raw: WarmStore = new MemoryWarmStore()) {
  const bounded = new BoundedWarmStore(raw, () => NOW);
  return { raw, bounded };
}

describe("WarmStore memory adapter and BoundedWarmStore (HEL-1575 D5)", () => {
  afterEach(() => jest.useRealTimers());

  it("round-trips an entry by user and dashboard", async () => {
    const { bounded } = make();
    const entry = storedEntry({ dashboardId: "d1", lastViewedAt: NOW });
    expect(await bounded.write(entry)).toBe(true);
    expect(await bounded.read("user-1", "d1")).toEqual(entry);
    expect(await bounded.read("user-1", "other")).toBeUndefined();
  });

  it("never returns another user's entry, even under the same dashboard id", async () => {
    const { raw, bounded } = make();
    await raw.put(warmKey("user-1", "d1"), storedEntry({ dashboardId: "d1", userId: "user-2" }));
    expect(await bounded.read("user-1", "d1")).toBeUndefined();
  });

  it("stores ONLY the allow-listed entry keys and window keys (no unexpected field reaches storage)", async () => {
    const { raw, bounded } = make();
    const dirty = {
      ...storedEntry({
        dashboardId: "d1",
        lastViewedAt: NOW,
        rows: {
          p1: {
            currentPage: 0,
            hasMore: false,
            rows: [],
            materialized: true,
            total: 0,
            capturedAt: 1,
            // fields that must NOT survive:
            isLoadingMore: true,
            lastFetchOk: true,
            lastError: { message: "x" },
          } as never,
        },
      }),
      sessionToken: "secret",
      shareLink: "https://example.test/s/abc",
      headers: { Authorization: "Bearer x" },
    } as never;
    await bounded.write(dirty);
    const stored = (await raw.get(warmKey("user-1", "d1"))) as unknown as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual([...WARM_ENTRY_KEYS].sort());
    const window = (stored.rows as Record<string, Record<string, unknown>>).p1;
    for (const key of Object.keys(window)) expect(WARM_WINDOW_KEYS).toContain(key);
    expect(JSON.stringify(stored)).not.toMatch(/secret|Bearer|share/);
    expect(sanitizeEntry(dirty)).toEqual(stored);
  });

  it("does not store an entry over 1 MiB and deletes any older copy of that key", async () => {
    const { raw, bounded } = make();
    await bounded.write(storedEntry({ dashboardId: "d1", lastViewedAt: NOW }));
    const huge = storedEntry({
      dashboardId: "d1",
      lastViewedAt: NOW,
      rows: {
        p: {
          currentPage: 0,
          hasMore: false,
          materialized: true,
          total: 1,
          capturedAt: 1,
          rows: [{ blob: "x".repeat(1024 * 1024) }],
        },
      },
    });
    expect(await bounded.write(huge)).toBe(false);
    expect(await raw.get(warmKey("user-1", "d1"))).toBeUndefined();
  });

  it(`keeps at most the ${WARM_MAX} latest-viewed entries per user after each write`, async () => {
    const { bounded } = make();
    for (let i = 0; i < WARM_MAX + 3; i++) {
      await bounded.write(storedEntry({ dashboardId: `d${i}`, lastViewedAt: NOW - 1_000 + i }));
    }
    const kept = [];
    for (let i = 0; i < WARM_MAX + 3; i++) {
      if (await bounded.read("user-1", `d${i}`)) kept.push(i);
    }
    expect(kept).toHaveLength(WARM_MAX);
    // the three oldest-viewed (d0..d2) are the ones that went
    expect(kept).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("purges entries past the TTL on the next write", async () => {
    const { raw, bounded } = make();
    await raw.put(
      warmKey("user-1", "old"),
      storedEntry({ dashboardId: "old", lastViewedAt: NOW - WARM_TTL_MS - 1 }),
    );
    await bounded.write(storedEntry({ dashboardId: "new", lastViewedAt: NOW }));
    expect(await bounded.read("user-1", "old")).toBeUndefined();
    expect(await bounded.read("user-1", "new")).toBeDefined();
  });

  it("deletes every entry that is not the signed-in user's at startup", async () => {
    const { raw, bounded } = make();
    await raw.put(warmKey("user-2", "d1"), storedEntry({ dashboardId: "d1", userId: "user-2" }));
    await raw.put(warmKey("user-1", "d2"), storedEntry({ dashboardId: "d2" }));
    await bounded.purgeOtherUsers("user-1");
    expect((await raw.entries()).map((e) => e.key)).toEqual([warmKey("user-1", "d2")]);
  });

  it("removeWhere deletes only the matching entries of the user", async () => {
    const { bounded } = make();
    await bounded.write(storedEntry({ dashboardId: "d1", lastViewedAt: NOW }));
    await bounded.write(storedEntry({ dashboardId: "d2", lastViewedAt: NOW }));
    await bounded.removeWhere("user-1", (e) => e.dashboardId === "d1");
    expect(await bounded.read("user-1", "d1")).toBeUndefined();
    expect(await bounded.read("user-1", "d2")).toBeDefined();
  });

  it("patchOwnWrite only moves ownWriteAt forward", async () => {
    const { bounded } = make();
    await bounded.write(storedEntry({ dashboardId: "d1", lastViewedAt: NOW, ownWriteAt: 500 }));
    await bounded.patchOwnWrite("user-1", "d1", 400);
    expect((await bounded.read("user-1", "d1"))?.ownWriteAt).toBe(500);
    await bounded.patchOwnWrite("user-1", "d1", 900);
    expect((await bounded.read("user-1", "d1"))?.ownWriteAt).toBe(900);
  });

  describe("clear (design D5 clearWarmState steps 1, 3, 4)", () => {
    it("cancels pending debounced writes", async () => {
      jest.useFakeTimers();
      const { raw, bounded } = make();
      const build = jest.fn(() => storedEntry({ dashboardId: "d1", lastViewedAt: NOW }));
      bounded.scheduleWrite("user-1", "d1", build);
      const cleared = bounded.clear();
      await jest.advanceTimersByTimeAsync(WARM_WRITE_DEBOUNCE_MS * 3);
      await cleared;
      expect(build).not.toHaveBeenCalled();
      expect(await raw.entries()).toEqual([]);
    });

    it("an in-flight write that started before the clear is dropped (wrong epoch)", async () => {
      const { raw, bounded } = make();
      const epoch = bounded.epoch;
      await bounded.clear();
      expect(await bounded.write(storedEntry({ dashboardId: "d1" }), epoch)).toBe(false);
      expect(await raw.entries()).toEqual([]);
    });

    it("a write whose epoch changes while its put is in flight reports failure and purges nothing", async () => {
      const raw = new MemoryWarmStore();
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => (release = resolve));
      // Hold the browser-store `put` so the clear lands while the write is in flight.
      const originalPut = raw.put.bind(raw);
      jest.spyOn(raw, "put").mockImplementation(async (k, e) => {
        await gate;
        return originalPut(k, e);
      });
      const { bounded } = make(raw);
      const epoch = bounded.epoch;
      const writing = bounded.write(storedEntry({ dashboardId: "d1", lastViewedAt: NOW }), epoch);
      const cleared = bounded.clear();
      release();
      expect(await writing).toBe(false);
      await cleared;
    });

    it("closes the connection BEFORE deleting the database", async () => {
      const order: string[] = [];
      const raw = new MemoryWarmStore();
      jest.spyOn(raw, "close").mockImplementation(() => void order.push("close"));
      jest.spyOn(raw, "destroy").mockImplementation(async () => void order.push("destroy"));
      await make(raw).bounded.clear();
      expect(order).toEqual(["close", "destroy"]);
    });

    it("keeps working for the next user after a clear", async () => {
      const { bounded } = make();
      await bounded.clear();
      expect(
        await bounded.write(
          storedEntry({ dashboardId: "d1", userId: "user-2", lastViewedAt: NOW }),
        ),
      ).toBe(true);
    });
  });
});
