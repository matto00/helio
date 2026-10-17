import {
  createDashboardSeenStore,
  DASHBOARD_SEEN_MAX_ENTRIES,
  DASHBOARD_SEEN_STORAGE_KEY,
  loadDashboardSeen,
} from "./dashboardSeenStore";
import { createRecentHistoryStore } from "./recentHistoryStore";

const KEY = "test.dashboardSeen";

describe("dashboardSeenStore", () => {
  beforeEach(() => window.localStorage.clear());

  it("stamps viewedAt and keeps ownWriteAt (and vice versa)", () => {
    const store = createDashboardSeenStore(KEY);
    store.recordOwnWrite("a", 5);
    store.recordViewed("a", 10);
    expect(store.get("a")).toEqual({ viewedAt: 10, ownWriteAt: 5 });
    store.recordOwnWrite("a", 20);
    expect(store.get("a")).toEqual({ viewedAt: 10, ownWriteAt: 20 });
  });

  it("persists and reloads", () => {
    createDashboardSeenStore(KEY).recordViewed("a", 10);
    expect(createDashboardSeenStore(KEY).get("a")).toEqual({ viewedAt: 10 });
  });

  it("discards a malformed blob whole", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ a: { viewedAt: "x" } }));
    expect(loadDashboardSeen(KEY)).toEqual({});
    window.localStorage.setItem(KEY, "not json");
    expect(loadDashboardSeen(KEY)).toEqual({});
    window.localStorage.setItem(KEY, JSON.stringify([1]));
    expect(loadDashboardSeen(KEY)).toEqual({});
  });

  it("prunes dashboards that no longer exist, notifying subscribers once", () => {
    const store = createDashboardSeenStore(KEY);
    store.recordViewed("keep", 1);
    store.recordViewed("gone", 2);
    const listener = jest.fn();
    store.subscribe(listener);
    store.pruneMissing(new Set(["keep"]));
    expect(Object.keys(store.getAll())).toEqual(["keep"]);
    expect(listener).toHaveBeenCalledTimes(1);
    store.pruneMissing(new Set(["keep"]));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("caps at the maximum, dropping the least recently touched", () => {
    const store = createDashboardSeenStore(KEY);
    for (let i = 0; i < DASHBOARD_SEEN_MAX_ENTRIES + 3; i += 1) store.recordViewed(`d${i}`, i);
    expect(Object.keys(store.getAll())).toHaveLength(DASHBOARD_SEEN_MAX_ENTRIES);
    expect(store.get("d0")).toBeUndefined();
    expect(store.get(`d${DASHBOARD_SEEN_MAX_ENTRIES + 2}`)).toBeDefined();
  });

  it("is independent of the palette's recent-visit list: a recordVisit never erases a stamp", () => {
    const seen = createDashboardSeenStore(KEY);
    const recents = createRecentHistoryStore("test.recents");
    seen.recordViewed("x", 42);
    recents.recordVisit("dashboard", "x", "X");
    recents.recordVisit("dashboard", "x", "X renamed");
    expect(seen.get("x")).toEqual({ viewedAt: 42 });
  });

  it("is not evicted by visiting twelve pipelines and sources (the ten-entry list cap)", () => {
    const seen = createDashboardSeenStore(KEY);
    const recents = createRecentHistoryStore("test.recents");
    seen.recordViewed("x", 42);
    for (let i = 0; i < 6; i += 1) recents.recordVisit("pipeline", `p${i}`);
    for (let i = 0; i < 6; i += 1) recents.recordVisit("source", `s${i}`);
    expect(recents.getEntries().some((entry) => entry.id === "x")).toBe(false);
    expect(seen.get("x")).toEqual({ viewedAt: 42 });
  });

  it("uses its own storage key", () => {
    expect(DASHBOARD_SEEN_STORAGE_KEY).toBe("helio.dashboardSeen");
  });
});
