import { resolveDashboardLayout, scaleLayoutItem } from "./dashboardLayout";
import { findOverlaps, isLayoutValid } from "./breakpointLayout";
import type { DashboardLayout, DashboardLayoutItem } from "../types/dashboard";
import { makeOutputPanel } from "../../../test/panelFixtures";

const makePanel = (id: string) =>
  makeOutputPanel({
    id,
    dashboardId: "dashboard-1",
    title: id,
    meta: {
      createdBy: "s",
      createdAt: "2026-03-14T00:00:00Z",
      lastUpdated: "2026-03-14T00:00:00Z",
    },
    appearance: { background: "transparent", color: "inherit", transparency: 0 },
  });

const item = (
  panelId: string,
  x: number,
  y: number,
  w: number,
  h: number,
): DashboardLayoutItem => ({
  panelId,
  x,
  y,
  w,
  h,
});

const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
const panels = ids.map(makePanel);
const COLS = { lg: 12, md: 10, sm: 6, xs: 2 } as const;
const bps = ["lg", "md", "sm", "xs"] as const;

const lgSeed = [
  item("a", 0, 0, 4, 6),
  item("b", 4, 0, 8, 6),
  item("c", 0, 6, 6, 5),
  item("d", 6, 6, 6, 5),
  item("e", 0, 11, 5, 5),
  item("f", 5, 11, 7, 5),
  item("g", 0, 16, 6, 3),
  item("h", 6, 16, 6, 3),
];
const reading = (items: DashboardLayoutItem[]) =>
  [...items].sort((p, q) => p.y - q.y || p.x - q.x).map((i) => i.panelId);
const empty = (): DashboardLayout => ({ lg: [], md: [], sm: [], xs: [] });
const expectAllValid = (resolved: DashboardLayout) => {
  for (const bp of bps) {
    expect(isLayoutValid(resolved[bp], COLS[bp])).toBe(true);
    expect(resolved[bp].map((i) => i.panelId)).toEqual(ids);
  }
};

describe("resolveDashboardLayout: valid authored layouts render exactly as saved", () => {
  // Gaps everywhere: an empty row (y 4-7), an empty column band, and a lone far-away panel.
  const gapped: DashboardLayout = {
    lg: [
      item("a", 0, 0, 4, 4),
      item("b", 6, 0, 6, 4),
      item("c", 1, 8, 5, 4),
      item("d", 8, 9, 4, 4),
      item("e", 0, 15, 4, 3),
      item("f", 6, 15, 6, 3),
      item("g", 0, 22, 5, 2),
      item("h", 7, 30, 5, 2),
    ],
    md: [
      item("a", 0, 0, 3, 4),
      item("b", 5, 0, 5, 4),
      item("c", 1, 8, 4, 4),
      item("d", 7, 9, 3, 4),
      item("e", 0, 15, 3, 3),
      item("f", 5, 15, 5, 3),
      item("g", 0, 22, 4, 2),
      item("h", 6, 30, 4, 2),
    ],
    sm: [
      item("a", 0, 0, 2, 4),
      item("b", 3, 0, 3, 4),
      item("c", 1, 8, 3, 4),
      item("d", 4, 9, 2, 4),
      item("e", 0, 15, 2, 3),
      item("f", 3, 15, 3, 3),
      item("g", 0, 22, 2, 2),
      item("h", 4, 30, 2, 2),
    ],
    xs: [
      item("a", 0, 0, 2, 4),
      item("b", 0, 6, 2, 4),
      item("c", 0, 12, 2, 4),
      item("d", 0, 20, 2, 4),
      item("e", 0, 26, 2, 4),
      item("f", 0, 32, 2, 4),
      item("g", 0, 40, 2, 2),
      item("h", 0, 50, 2, 2),
    ],
  };

  it("is value-identical at EVERY breakpoint (fails under an always-compact mutant)", () => {
    const resolved = resolveDashboardLayout(panels, gapped);
    for (const bp of bps) expect(resolved[bp]).toEqual(gapped[bp]);
    // Guard that the fixture really has gaps: compacting it WOULD change it.
    expect(
      bps.some((bp) =>
        gapped[bp].some((item) => item.y > 0 && !gapped[bp].some((o) => o.y + o.h === item.y)),
      ),
    ).toBe(true);
  });

  it("returns entries in panel order even when saved in another order", () => {
    const shuffled = { ...gapped, lg: [...gapped.lg].reverse() };
    expect(resolveDashboardLayout(panels, shuffled).lg).toEqual(gapped.lg);
  });
});

describe("resolveDashboardLayout: derive and repair", () => {
  it("lg only: md, sm and xs derive valid, non-overlapping layouts in lg reading order", () => {
    const resolved = resolveDashboardLayout(panels, { ...empty(), lg: lgSeed });
    expectAllValid(resolved);
    expect(resolved.lg).toEqual(lgSeed);
    for (const bp of ["md", "sm", "xs"] as const) expect(reading(resolved[bp])).toEqual(ids);
  });

  it("no layout at all: default non-overlapping placement everywhere", () => {
    expectAllValid(resolveDashboardLayout(panels, empty()));
  });

  it("lg coordinates stored under md/sm/xs are bounds-violating: derived, never rendered as saved", () => {
    const copy = () => lgSeed.map((i) => ({ ...i }));
    const resolved = resolveDashboardLayout(panels, {
      lg: lgSeed,
      md: copy(),
      sm: copy(),
      xs: copy(),
    });
    expectAllValid(resolved);
    expect(reading(resolved.xs)).toEqual(ids);
  });

  it("a bounds-violating breakpoint is never a source for another one", () => {
    // md holds a 12-col layout that is the nearest breakpoint to sm, but must be ignored: sm derives
    // from lg (valid) in lg reading order, not from md's clamped garbage.
    const garbageMd = lgSeed.map((i) => ({ ...i, y: 40 - i.y }));
    const resolved = resolveDashboardLayout(panels, { ...empty(), lg: lgSeed, md: garbageMd });
    expect(reading(resolved.sm)).toEqual(ids);
    expect(reading(resolved.md)).toEqual(ids);
  });

  it("overlapping saved layout at the active breakpoint is repaired in place, order kept", () => {
    const md = [
      item("a", 0, 0, 5, 6),
      item("b", 2, 0, 5, 6),
      item("c", 0, 6, 5, 5),
      item("d", 3, 6, 7, 5),
      item("e", 0, 11, 5, 5),
      item("f", 0, 12, 6, 5),
      item("g", 5, 16, 5, 3),
      item("h", 6, 17, 4, 3),
    ];
    const resolved = resolveDashboardLayout(panels, { ...empty(), lg: lgSeed, md });
    expect(findOverlaps(resolved.md)).toEqual([]);
    expect(resolved.md.find((i) => i.panelId === "a")).toEqual(md[0]);
    expect(isLayoutValid(resolved.md, 10)).toBe(true);
  });

  it("only authored breakpoint overlaps: the others derive from its repaired form", () => {
    const lg = [item("a", 0, 0, 6, 6), item("b", 3, 0, 9, 6), ...lgSeed.slice(2)];
    const resolved = resolveDashboardLayout(panels, { ...empty(), lg });
    expectAllValid(resolved);
    // b was bumped below a in lg's repaired form; md/sm/xs keep that order (a before b).
    for (const bp of ["md", "sm", "xs"] as const) {
      expect(reading(resolved[bp]).indexOf("a")).toBeLessThan(reading(resolved[bp]).indexOf("b"));
    }
  });

  it("overlapping and partial: repaired anchors first, then omitted panels in free space", () => {
    const md = [item("a", 0, 0, 5, 4), item("b", 3, 0, 5, 4)]; // overlap, and only 2 of 8 live
    const resolved = resolveDashboardLayout(panels, { ...empty(), lg: lgSeed, md });
    expectAllValid(resolved);
    const a = resolved.md.find((i) => i.panelId === "a");
    expect(a).toEqual(md[0]); // the anchor never moves
  });

  it("partial: saved entries never move; omitted panels derive from the nearest authored breakpoint", () => {
    const md = [item("a", 0, 0, 4, 6), item("b", 4, 0, 6, 6)];
    const resolved = resolveDashboardLayout(panels, { ...empty(), lg: lgSeed, md });
    expectAllValid(resolved);
    expect(resolved.md.slice(0, 2)).toEqual(md);
    // c derives from lg (6 wide of 12) -> 5 wide of 10, placed below the anchors.
    expect(resolved.md.find((i) => i.panelId === "c")).toMatchObject({ w: 5 });
  });

  it("a partial breakpoint still serves as source for the panels it holds; others come from the next nearest", () => {
    const sm = [item("a", 0, 0, 3, 6), item("b", 3, 0, 3, 6)];
    const resolved = resolveDashboardLayout(panels, { ...empty(), lg: lgSeed, sm });
    expectAllValid(resolved);
    // xs: a and b come from sm (nearest), the rest from lg.
    expect(reading(resolved.xs).slice(0, 2)).toEqual(["a", "b"]);
  });

  it("stale ids defeat neither derivation nor placement", () => {
    const md = [item("zz1", 0, 0, 5, 5), item("zz2", 5, 0, 5, 5), item("a", 0, 5, 4, 6), ...[]];
    const resolved = resolveDashboardLayout(panels, { ...empty(), lg: lgSeed, md });
    expectAllValid(resolved);
    expect(resolved.md.some((i) => i.panelId.startsWith("zz"))).toBe(false);
    // Omitted live panels derive from lg, not default width (default md width is 4; b is 8/12*10 = 7).
    expect(resolved.md.find((i) => i.panelId === "b")!.w).toBe(7);
  });

  it("copes with a layout for another board's panels (disjoint ids) without throwing", () => {
    const other = [item("x1", 0, 0, 4, 4), item("x2", 4, 0, 4, 4)];
    const resolved = resolveDashboardLayout([makePanel("a"), makePanel("b")], {
      lg: other,
      md: other,
      sm: other,
      xs: other,
    });
    for (const bp of bps) expect(isLayoutValid(resolved[bp], COLS[bp])).toBe(true);
  });

  it("is deterministic: same inputs give equal output", () => {
    const layout = { ...empty(), lg: lgSeed };
    expect(resolveDashboardLayout(panels, layout)).toEqual(resolveDashboardLayout(panels, layout));
  });

  it("a panel appended per breakpoint onto empty arrays (createPanel) resolves valid with it anchored", () => {
    // panelThunks.createPanel appends one scaled item to each breakpoint's (possibly empty) array.
    const lgItem = item("i", 0, 19, 4, 5);
    const layout: DashboardLayout = {
      lg: [...lgSeed, lgItem],
      md: [scaleLayoutItem(lgItem, 12, 10)],
      sm: [scaleLayoutItem(lgItem, 12, 6)],
      xs: [scaleLayoutItem(lgItem, 12, 2)],
    };
    const all = [...panels, makePanel("i")];
    const resolved = resolveDashboardLayout(all, layout);
    for (const bp of bps) {
      expect(isLayoutValid(resolved[bp], COLS[bp])).toBe(true);
      expect(resolved[bp]).toHaveLength(9);
      expect(resolved[bp].find((i) => i.panelId === "i")).toEqual(
        layout[bp][layout[bp].length - 1],
      );
    }
  });
});
