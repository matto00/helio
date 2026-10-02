import {
  compactLayout,
  findOverlaps,
  isLayoutValid,
  nearestAuthoredBreakpoint,
  rectsOverlap,
  scaleLayoutItem,
} from "./breakpointLayout";
import type { DashboardLayoutItem } from "../types/dashboard";

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

// The lg layout reproduced on prod ("News Overview"): 12 columns, eight panels, gap-free.
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

describe("rectsOverlap / findOverlaps / isLayoutValid", () => {
  it("treats touching edges as not overlapping and shared cells as overlapping", () => {
    expect(rectsOverlap(item("a", 0, 0, 2, 2), item("b", 2, 0, 2, 2))).toBe(false);
    expect(rectsOverlap(item("a", 0, 0, 2, 2), item("b", 0, 2, 2, 2))).toBe(false);
    expect(rectsOverlap(item("a", 0, 0, 2, 2), item("b", 1, 1, 2, 2))).toBe(true);
  });

  it("lists every overlapping pair in input order", () => {
    const items = [item("a", 0, 0, 4, 4), item("b", 2, 2, 4, 4), item("c", 8, 0, 2, 2)];
    expect(findOverlaps(items).map(([p, q]) => `${p.panelId}${q.panelId}`)).toEqual(["ab"]);
  });

  it("requires bounds as well as no overlap", () => {
    expect(isLayoutValid(lgSeed, 12)).toBe(true);
    // 12-column coordinates are out of bounds under 10 columns even though nothing overlaps.
    expect(isLayoutValid(lgSeed, 10)).toBe(false);
    expect(isLayoutValid([item("a", 0, 0, 0, 2)], 12)).toBe(false);
    expect(isLayoutValid([item("a", -1, 0, 2, 2)], 12)).toBe(false);
    expect(isLayoutValid([item("a", 0, 0, 2, 2), item("b", 1, 0, 2, 2)], 12)).toBe(false);
  });

  it("keeps an authored layout with gaps valid", () => {
    expect(isLayoutValid([item("a", 0, 0, 2, 2), item("b", 8, 9, 2, 2)], 12)).toBe(true);
  });
});

describe("compactLayout", () => {
  it("clamps into the column count and removes overlaps", () => {
    const out = compactLayout(
      [item("a", 0, 0, 8, 4), item("b", 6, 0, 8, 4), item("c", 3, 1, 20, 2)],
      10,
    );
    expect(isLayoutValid(out, 10)).toBe(true);
  });

  it("returns items in input order and never moves a valid compact layout", () => {
    const valid = [item("a", 0, 0, 5, 3), item("b", 5, 0, 5, 3), item("c", 0, 3, 10, 2)];
    expect(compactLayout(valid, 10)).toEqual(valid);
  });

  it("slides an overlapping item down just below its collider and keeps reading order", () => {
    const out = compactLayout(
      [item("a", 0, 0, 6, 4), item("b", 3, 0, 6, 4), item("c", 0, 4, 6, 4)],
      12,
    );
    expect(out.find((i) => i.panelId === "b")).toMatchObject({ x: 3, y: 4 });
    expect(isLayoutValid(out, 12)).toBe(true);
    expect(reading(out)).toEqual(
      ["a", "b", "c"].sort((p, q) => reading(out).indexOf(p) - reading(out).indexOf(q)),
    );
  });

  it("is idempotent across random layouts (property check, seeded)", () => {
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let trial = 0; trial < 200; trial++) {
      const cols = [2, 6, 10, 12][rnd(4)];
      const items = Array.from({ length: 1 + rnd(9) }, (_, i) =>
        item(`p${i}`, rnd(cols + 3) - 1, rnd(12) - 1, rnd(cols + 3), rnd(6)),
      );
      const once = compactLayout(items, cols);
      expect(isLayoutValid(once, cols)).toBe(true);
      expect(compactLayout(once, cols)).toEqual(once);
    }
  });
});

describe("scale then compact, as the resolver derives (HEL-1023 repro seeds)", () => {
  it.each([
    ["md", 10],
    ["sm", 6],
    ["xs", 2],
  ])("derives a valid %s layout from lg and keeps lg reading order", (_name, cols) => {
    const out = compactLayout(
      lgSeed.map((i) => scaleLayoutItem(i, 12, cols)),
      cols,
    );
    expect(isLayoutValid(out, cols)).toBe(true);
    expect(reading(out)).toEqual(reading(lgSeed));
    expect(out.map((i) => i.panelId)).toEqual(lgSeed.map((i) => i.panelId));
  });

  it("derives a valid layout from lg coordinates mistakenly stored under md", () => {
    // Bounds-violating input (x + w up to 12 in 10 columns) is clamped then compacted.
    expect(isLayoutValid(compactLayout(lgSeed, 10), 10)).toBe(true);
  });
});

describe("nearestAuthoredBreakpoint", () => {
  it("orders by index distance, preferring the wider breakpoint on ties", () => {
    expect(nearestAuthoredBreakpoint("md", ["lg", "sm", "xs"])).toEqual(["lg", "sm", "xs"]);
    expect(nearestAuthoredBreakpoint("sm", ["lg", "md", "xs"])).toEqual(["md", "xs", "lg"]);
    expect(nearestAuthoredBreakpoint("xs", ["lg", "md"])).toEqual(["md", "lg"]);
  });

  it("never returns the target itself", () => {
    expect(nearestAuthoredBreakpoint("lg", ["lg", "md"])).toEqual(["md"]);
  });
});
