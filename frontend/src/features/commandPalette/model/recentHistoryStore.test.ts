import {
  RECENT_HISTORY_MAX_ENTRIES,
  createRecentHistoryStore,
  loadRecentHistory,
} from "./recentHistoryStore";

function freshKey(): string {
  return `helio.recentVisits.test.${Math.random()}`;
}

describe("recentHistoryStore — ordering, de-duplication, cap eviction (task 2.1)", () => {
  it("records visits most-recent-first", () => {
    const store = createRecentHistoryStore(freshKey());
    store.recordVisit("dashboard", "d1");
    store.recordVisit("source", "s1");
    expect(store.getEntries().map((e) => e.id)).toEqual(["s1", "d1"]);
  });

  it("a re-visit MOVES the entry rather than duplicating it", () => {
    const store = createRecentHistoryStore(freshKey());
    store.recordVisit("dashboard", "d1");
    store.recordVisit("source", "s1");
    store.recordVisit("dashboard", "d1");
    const entries = store.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.id)).toEqual(["d1", "s1"]);
  });

  it("caps at RECENT_HISTORY_MAX_ENTRIES, discarding the least recent", () => {
    const store = createRecentHistoryStore(freshKey());
    for (let i = 0; i < RECENT_HISTORY_MAX_ENTRIES + 3; i++) {
      store.recordVisit("source", `s${i}`);
    }
    const entries = store.getEntries();
    expect(entries).toHaveLength(RECENT_HISTORY_MAX_ENTRIES);
    // Most recent (highest i) kept, oldest (s0, s1, s2) evicted.
    expect(entries.map((e) => e.id)).not.toContain("s0");
    expect(entries[0].id).toBe(`s${RECENT_HISTORY_MAX_ENTRIES + 2}`);
  });
});

describe("recentHistoryStore — persistence safety (task 2.2, design.md D3)", () => {
  it("an absent key loads to an empty, working history", () => {
    expect(loadRecentHistory(freshKey())).toEqual([]);
  });

  it("malformed JSON discards to an empty history without throwing", () => {
    const key = freshKey();
    window.localStorage.setItem(key, "{not json");
    expect(() => loadRecentHistory(key)).not.toThrow();
    expect(loadRecentHistory(key)).toEqual([]);
  });

  it("well-formed JSON of the wrong shape discards the WHOLE blob", () => {
    const key = freshKey();
    window.localStorage.setItem(key, JSON.stringify([{ id: "d1" /* missing kind/visitedAt */ }]));
    expect(loadRecentHistory(key)).toEqual([]);
  });

  it("a throwing setItem does not break recordVisit (navigation still succeeds)", () => {
    const key = freshKey();
    const store = createRecentHistoryStore(key);
    const setItemSpy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => store.recordVisit("dashboard", "d1")).not.toThrow();
    // The in-memory store still reflects the visit even though persistence failed.
    expect(store.getEntries().map((e) => e.id)).toEqual(["d1"]);
    setItemSpy.mockRestore();
  });

  it("a null-id write is never possible through the public API (defense in depth)", () => {
    // recordVisit's signature requires a string id — this test documents that the type system,
    // not a runtime guard here, is what prevents it. The real guard against a null-id ENTRY is
    // recentVisitsListeners.test.ts's dashboard-deselection case, upstream of this store.
    const store = createRecentHistoryStore(freshKey());
    store.recordVisit("dashboard", "d1");
    expect(store.getEntries().every((e) => typeof e.id === "string" && e.id.length > 0)).toBe(true);
  });
});

describe("recentHistoryStore — persisted title (skeptic-final-1.md CR1)", () => {
  it("persists a title passed to recordVisit", () => {
    const store = createRecentHistoryStore(freshKey());
    store.recordVisit("source", "s1", "My Source");
    expect(store.getEntries()[0]).toMatchObject({ id: "s1", title: "My Source" });
  });

  it("a re-visit with a NEW title overwrites the old one (self-heals after a rename)", () => {
    const store = createRecentHistoryStore(freshKey());
    store.recordVisit("source", "s1", "Old Name");
    store.recordVisit("source", "s1", "New Name");
    expect(store.getEntries()).toHaveLength(1);
    expect(store.getEntries()[0].title).toBe("New Name");
  });

  it("omitting the title leaves the entry without one (no placeholder/blank string)", () => {
    const store = createRecentHistoryStore(freshKey());
    store.recordVisit("source", "s1");
    expect(store.getEntries()[0].title).toBeUndefined();
  });

  it("migration: an entry written before `title` existed loads successfully, untitled", () => {
    const key = freshKey();
    // Simulates a pre-this-change stored blob: no `title` field at all.
    window.localStorage.setItem(
      key,
      JSON.stringify([{ kind: "source", id: "s1", visitedAt: Date.now() }]),
    );
    const entries = loadRecentHistory(key);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBeUndefined();
  });

  it("a non-string, non-undefined `title` on an entry discards the WHOLE blob (D3's rule, not a per-field patch-up)", () => {
    const key = freshKey();
    window.localStorage.setItem(
      key,
      JSON.stringify([{ kind: "source", id: "s1", visitedAt: Date.now(), title: 42 }]),
    );
    expect(loadRecentHistory(key)).toEqual([]);
  });
});

describe("recentHistoryStore — pruning (task 4.1/4.2, design.md D4)", () => {
  it("drops an entry whose id is confirmed absent from a resolved collection", () => {
    const store = createRecentHistoryStore(freshKey());
    store.recordVisit("source", "s1");
    store.recordVisit("source", "s2");
    store.pruneMissing("source", new Set(["s2"]));
    expect(store.getEntries().map((e) => e.id)).toEqual(["s2"]);
  });

  it("retains entries of a DIFFERENT kind untouched by a prune", () => {
    const store = createRecentHistoryStore(freshKey());
    store.recordVisit("source", "s1");
    store.recordVisit("pipeline", "p1");
    store.pruneMissing("source", new Set());
    expect(store.getEntries().map((e) => e.id)).toEqual(["p1"]);
  });
});
