import { buildLayoutPatch } from "./layoutPatch";
import type { DashboardLayout } from "../types/dashboard";

const item = (panelId: string, x: number, y: number, w = 1, h = 2) => ({ panelId, x, y, w, h });
const empty: DashboardLayout = { lg: [], md: [], sm: [], xs: [] };

describe("buildLayoutPatch", () => {
  const baseline: DashboardLayout = {
    ...empty,
    lg: [item("a", 0, 0, 6), item("b", 6, 0, 6)],
    xs: [item("a", 0, 0), item("b", 0, 0)], // stored-bad: same cell
  };

  it("sends nothing for breakpoints equal to the baseline (partial PATCH)", () => {
    expect(buildLayoutPatch(baseline, baseline, null)).toEqual({});
  });

  it("sends a changed, valid breakpoint as authored and omits the unchanged ones", () => {
    const next = { ...baseline, lg: [item("a", 0, 0, 6), item("b", 6, 2, 6)] };
    expect(buildLayoutPatch(next, baseline, null)).toEqual({ lg: next.lg });
  });

  it("replaces a changed-and-invalid breakpoint with the resolved one", () => {
    const next = { ...baseline, xs: [item("a", 0, 0), item("b", 0, 1, 1, 2), item("c", 0, 1)] };
    const resolved = { ...next, xs: [item("a", 0, 0), item("b", 1, 0), item("c", 0, 2)] };
    expect(buildLayoutPatch(next, baseline, resolved)).toEqual({ xs: resolved.xs });
  });

  it("sends a changed-and-invalid breakpoint as authored when nothing is resolved (panels not loaded)", () => {
    const next = { ...baseline, xs: [item("a", 0, 0), item("b", 0, 0), item("c", 1, 5, 2)] };
    expect(buildLayoutPatch(next, baseline, null)).toEqual({ xs: next.xs });
  });

  it("does not substitute a valid changed breakpoint even when a resolution is available", () => {
    const next = { ...baseline, xs: [item("a", 0, 0), item("b", 1, 0)] };
    const resolved = { ...next, xs: [item("a", 0, 0), item("b", 0, 2)] };
    expect(buildLayoutPatch(next, baseline, resolved)).toEqual({ xs: next.xs });
  });
});
