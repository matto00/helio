import { rebaseLayoutPatch } from "./layoutConflict";
import type { DashboardLayout, DashboardLayoutItem } from "../types/dashboard";

const item = (panelId: string, x: number, y: number, w = 4, h = 2): DashboardLayoutItem => ({
  panelId,
  x,
  y,
  w,
  h,
});
const layoutOf = (lg: DashboardLayoutItem[]): DashboardLayout => ({ lg, md: [], sm: [], xs: [] });

describe("rebaseLayoutPatch", () => {
  const base = layoutOf([item("a", 0, 0), item("b", 4, 0)]);

  it("keeps the user's changed item and takes every other item from the fresh layout", () => {
    const sent = { lg: [item("a", 0, 0), item("b", 8, 0)] };
    const fresh = layoutOf([item("a", 0, 0), item("b", 4, 0), item("c", 0, 2)]);
    expect(rebaseLayoutPatch(sent, base, fresh)).toEqual({
      lg: [item("a", 0, 0), item("b", 8, 0), item("c", 0, 2)],
    });
  });

  it("prefers the fresh position of an item the user did not touch", () => {
    const sent = { lg: [item("a", 0, 0), item("b", 8, 0)] };
    const fresh = layoutOf([item("a", 0, 4), item("b", 4, 0)]);
    expect(rebaseLayoutPatch(sent, base, fresh)).toEqual({
      lg: [item("a", 0, 4), item("b", 8, 0)],
    });
  });

  it("drops a panel the fresh layout no longer has", () => {
    const sent = { lg: [item("a", 0, 0), item("b", 8, 0)] };
    const fresh = layoutOf([item("a", 0, 0)]);
    expect(rebaseLayoutPatch(sent, base, fresh)).toEqual({ lg: [item("a", 0, 0)] });
  });

  it("only rebases the breakpoints that were sent", () => {
    const sent = { lg: [item("a", 0, 0), item("b", 4, 2)] };
    const fresh = { ...layoutOf([item("a", 0, 0), item("b", 4, 0)]), xs: [item("a", 0, 0, 2)] };
    expect(Object.keys(rebaseLayoutPatch(sent, base, fresh) ?? {})).toEqual(["lg"]);
  });

  it("answers null when the rebased breakpoint would overlap, so the server's refusal is never provoked", () => {
    const sent = { lg: [item("a", 0, 0), item("b", 4, 4)] };
    const fresh = layoutOf([item("a", 0, 0), item("b", 4, 0), item("c", 4, 4)]);
    expect(rebaseLayoutPatch(sent, base, fresh)).toBeNull();
  });
});
