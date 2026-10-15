import { isContentValid, isTabWarm, isWindowFresh, panelOutputIds } from "./warmValidity";
import { WARM_MAX, WARM_TTL_MS } from "./warmConfig";
import type { DashboardChange, DashboardTab } from "../tabTypes";
import { makeTextPanel } from "../../../../test/panelFixtures";
import { outputPanel } from "../../../../test/warmFixtures";

const NOW = Date.parse("2026-01-01T01:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const tab = (id: string, viewedMsAgo: number | null): DashboardTab => ({
  id,
  lastViewedAt: viewedMsAgo === null ? null : iso(NOW - viewedMsAgo),
  ownWriteAt: null,
});
const signal = (over: Partial<DashboardChange>): DashboardChange => ({
  dashboardId: "d",
  contentUpdatedAt: null,
  dataUpdatedAt: null,
  outputs: [],
  ...over,
});

describe("isTabWarm (design D4)", () => {
  it("is warm within the TTL", () => {
    expect(isTabWarm([tab("a", 1_000)], "a", NOW)).toBe(true);
    expect(isTabWarm([tab("a", WARM_TTL_MS)], "a", NOW)).toBe(true);
  });
  it("expires after the TTL: the tab still exists but is cold", () => {
    expect(isTabWarm([tab("a", WARM_TTL_MS + 1)], "a", NOW)).toBe(false);
  });
  it("a tab never viewed is never warm", () => {
    expect(isTabWarm([tab("a", null)], "a", NOW)).toBe(false);
  });
  it(`only the ${WARM_MAX} most recently viewed tabs are warm`, () => {
    const tabs = Array.from({ length: WARM_MAX + 2 }, (_, i) => tab(`t${i}`, 1_000 + i * 10));
    // t0 is the most recent; the two oldest-viewed (t8, t9) fall outside the 8.
    expect(isTabWarm(tabs, "t0", NOW)).toBe(true);
    expect(isTabWarm(tabs, `t${WARM_MAX - 1}`, NOW)).toBe(true);
    expect(isTabWarm(tabs, `t${WARM_MAX}`, NOW)).toBe(false);
    expect(isTabWarm(tabs, `t${WARM_MAX + 1}`, NOW)).toBe(false);
  });
});

describe("isContentValid (design D4: contentUpdatedAt <= max(contentCapturedAt, ownWriteAt))", () => {
  it("valid when the content has not changed since capture", () => {
    expect(isContentValid(2_000, null, signal({ contentUpdatedAt: iso(1_000) }))).toBe(true);
  });
  it("invalid when the content changed after capture (a content change fetches)", () => {
    expect(isContentValid(2_000, null, signal({ contentUpdatedAt: iso(3_000) }))).toBe(false);
  });
  it("the user's own write covers a content time at or before it", () => {
    expect(isContentValid(2_000, 5_000, signal({ contentUpdatedAt: iso(4_000) }))).toBe(true);
    expect(isContentValid(2_000, 5_000, signal({ contentUpdatedAt: iso(6_000) }))).toBe(false);
  });
  it("cannot be validated without a signal: not valid", () => {
    expect(isContentValid(2_000, null, undefined)).toBe(false);
    expect(isContentValid(2_000, null, signal({ contentUpdatedAt: null }))).toBe(false);
  });
});

describe("isWindowFresh", () => {
  const outputs = [{ outputId: "o1", dataUpdatedAt: iso(5_000) }];
  it("a window captured after the Output's last data is fresh (a run observed while active stays warm)", () => {
    expect(isWindowFresh(6_000, "o1", signal({ outputs }))).toBe(true);
  });
  it("a window captured before newer data is stale", () => {
    expect(isWindowFresh(4_000, "o1", signal({ outputs }))).toBe(false);
  });
  it("an Output with no data time, or absent from the signal, is fresh", () => {
    expect(isWindowFresh(1, "o2", signal({ outputs }))).toBe(true);
    expect(
      isWindowFresh(1, "o1", signal({ outputs: [{ outputId: "o1", dataUpdatedAt: null }] })),
    ).toBe(true);
  });
  it("a window with no capture instant is never fresh", () => {
    expect(isWindowFresh(undefined, "o1", signal({ outputs }))).toBe(false);
  });
});

describe("panelOutputIds", () => {
  it("collects the distinct bound Output ids of output panels only", () => {
    const ids = panelOutputIds([
      outputPanel("p1", "d", "o1"),
      outputPanel("p2", "d", "o1"),
      outputPanel("p3", "d", "o2"),
      makeTextPanel({ id: "p4", dashboardId: "d" }),
      outputPanel("p5", "d", ""),
    ]);
    expect(ids.sort()).toEqual(["o1", "o2"]);
  });
});
