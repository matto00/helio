import { makeTextPanel } from "../../../test/panelFixtures";
import type { DashboardLayout, DashboardLayoutItem } from "../types/dashboard";
import { findOverlaps } from "./breakpointLayout";
import { tidyLayout } from "./tidyLayout";

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
const panels = (...ids: string[]) => ids.map((id) => makeTextPanel({ id }));
const empty: DashboardLayout = { lg: [], md: [], sm: [], xs: [] };
const ys = (items: DashboardLayoutItem[]) => Object.fromEntries(items.map((i) => [i.panelId, i.y]));

describe("tidyLayout (HEL-1576 D8)", () => {
  it("removes a gap above a panel in a complete breakpoint without touching x, w or h", () => {
    const layout: DashboardLayout = {
      ...empty,
      lg: [item("form", 0, 0, 4, 5), item("next", 0, 9, 6, 4)],
    };
    const tidied = tidyLayout(layout, panels("form", "next"));
    expect(tidied.lg).toEqual([item("form", 0, 0, 4, 5), item("next", 0, 5, 6, 4)]);
  });

  it("returns the input object itself when nothing would move (already tidy)", () => {
    const layout: DashboardLayout = {
      ...empty,
      lg: [item("a", 0, 0, 6, 4), item("b", 6, 0, 6, 4), item("c", 0, 4, 12, 3)],
    };
    expect(tidyLayout(layout, panels("a", "b", "c"))).toBe(layout);
  });

  it("returns the input object for an empty layout", () => {
    expect(tidyLayout(empty, [])).toBe(empty);
  });

  it("compacts stacked columns independently and keeps top-to-bottom order", () => {
    const layout: DashboardLayout = {
      ...empty,
      lg: [
        item("a", 0, 0, 6, 3),
        item("b", 0, 10, 6, 3),
        item("c", 6, 0, 6, 3),
        item("d", 6, 20, 6, 3),
      ],
    };
    const tidied = tidyLayout(layout, panels("a", "b", "c", "d"));
    expect(ys(tidied.lg)).toEqual({ a: 0, b: 3, c: 0, d: 3 });
    expect(findOverlaps(tidied.lg)).toEqual([]);
  });

  it("closes gaps between full-width rows", () => {
    const layout: DashboardLayout = {
      ...empty,
      lg: [item("a", 0, 0, 12, 2), item("b", 0, 6, 12, 2), item("c", 0, 30, 12, 2)],
    };
    expect(ys(tidyLayout(layout, panels("a", "b", "c")).lg)).toEqual({ a: 0, b: 2, c: 4 });
  });

  it("tidies every breakpoint in one action", () => {
    const gap = (cols: number) => [item("a", 0, 0, cols, 2), item("b", 0, 8, cols, 2)];
    const layout: DashboardLayout = { lg: gap(12), md: gap(10), sm: gap(6), xs: gap(2) };
    const tidied = tidyLayout(layout, panels("a", "b"));
    for (const bp of ["lg", "md", "sm", "xs"] as const)
      expect(ys(tidied[bp])).toEqual({ a: 0, b: 2 });
  });

  it("leaves a breakpoint with no stored entries exactly as stored (unauthored)", () => {
    const layout: DashboardLayout = {
      ...empty,
      lg: [item("a", 0, 0, 6, 2), item("b", 0, 9, 6, 2)],
    };
    const tidied = tidyLayout(layout, panels("a", "b"));
    expect(tidied.md).toEqual([]);
  });

  it("leaves a breakpoint with an out-of-bounds entry as stored (the resolver treats it as unauthored)", () => {
    const outOfBounds = [item("a", 0, 0, 6, 2), item("b", 8, 9, 6, 2)]; // x + w = 14 > 12
    const layout: DashboardLayout = { ...empty, lg: outOfBounds };
    const tidied = tidyLayout(layout, panels("a", "b"));
    expect(tidied).toBe(layout);
  });

  it("partial breakpoint: moves only the stored entries and adds none", () => {
    // Three live panels, only a and b stored; c has no entry and must gain none.
    const layout: DashboardLayout = {
      ...empty,
      lg: [item("a", 0, 0, 6, 2), item("b", 0, 9, 6, 2)],
    };
    const tidied = tidyLayout(layout, panels("a", "b", "c"));
    expect(tidied.lg).toEqual([item("a", 0, 0, 6, 2), item("b", 0, 2, 6, 2)]);
    expect(tidied.lg.map((i) => i.panelId)).not.toContain("c");
  });

  it("keeps stored entries of panels this tab has not loaded unchanged and in place", () => {
    const ghost = item("ghost", 6, 40, 6, 4);
    const layout: DashboardLayout = {
      ...empty,
      lg: [item("a", 0, 0, 6, 2), ghost, item("b", 0, 9, 6, 2)],
    };
    const tidied = tidyLayout(layout, panels("a", "b"));
    expect(tidied.lg).toEqual([item("a", 0, 0, 6, 2), ghost, item("b", 0, 2, 6, 2)]);
  });

  it("an invisible (unloaded) entry does not enable the action on its own", () => {
    const layout: DashboardLayout = {
      ...empty,
      lg: [item("a", 0, 0, 6, 2), item("ghost", 6, 40, 6, 4)],
    };
    expect(tidyLayout(layout, panels("a"))).toBe(layout);
  });

  it("is idempotent", () => {
    const layout: DashboardLayout = {
      ...empty,
      lg: [item("a", 0, 0, 4, 5), item("b", 4, 12, 4, 3), item("c", 0, 20, 8, 2)],
    };
    const once = tidyLayout(layout, panels("a", "b", "c"));
    expect(tidyLayout(once, panels("a", "b", "c"))).toBe(once);
  });

  it("does not mutate its input", () => {
    const layout: DashboardLayout = {
      ...empty,
      lg: [item("a", 0, 0, 6, 2), item("b", 0, 9, 6, 2)],
    };
    const snapshot = JSON.stringify(layout);
    tidyLayout(layout, panels("a", "b"));
    expect(JSON.stringify(layout)).toBe(snapshot);
  });
});
