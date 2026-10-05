import { buildRepairPatch, hasRepairableBreakpoint } from "./repairPatch";
import type { DashboardLayout, DashboardLayoutItem } from "../types/dashboard";
import type { Panel } from "../../panels/types/panel";

const asPanels = (ids: string[]) => ids.map((id) => ({ id }) as Panel);
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

const complete: DashboardLayout = {
  lg: [item("a", 0, 0, 6, 4)],
  md: [item("a", 0, 0, 5, 4)],
  sm: [item("a", 0, 0, 3, 4)],
  xs: [item("a", 0, 0, 2, 4)],
};

describe("hasRepairableBreakpoint", () => {
  it("is false when every breakpoint is valid and holds every live panel", () => {
    expect(hasRepairableBreakpoint(asPanels(["a"]), complete)).toBe(false);
  });

  it("is true when a valid breakpoint is missing a live panel", () => {
    expect(hasRepairableBreakpoint(asPanels(["a", "b"]), complete)).toBe(true);
  });

  it("is true for an empty breakpoint on a dashboard with live panels", () => {
    expect(hasRepairableBreakpoint(asPanels(["a"]), { ...complete, md: [] })).toBe(true);
  });

  it("is false for an empty layout with no live panels", () => {
    expect(hasRepairableBreakpoint([], { lg: [], md: [], sm: [], xs: [] })).toBe(false);
  });

  it("is true for a stored-bad breakpoint even when it holds every panel", () => {
    const bad = { ...complete, xs: [item("a", 0, 0, 3, 4)] };
    expect(hasRepairableBreakpoint(asPanels(["a"]), bad)).toBe(true);
  });
});

describe("buildRepairPatch with an incomplete breakpoint", () => {
  it("includes a valid breakpoint missing a live panel", () => {
    const patch = buildRepairPatch(asPanels(["a", "b"]), complete);
    expect(Object.keys(patch).sort()).toEqual(["lg", "md", "sm", "xs"]);
  });

  it("is append-only: every stored live item is kept byte-for-byte and only the orphan is added", () => {
    const stored: DashboardLayout = {
      ...complete,
      lg: [item("a", 2, 3, 6, 4)],
    };
    const patch = buildRepairPatch(asPanels(["a", "b"]), stored);
    const lg = patch.lg!;
    expect(lg.find((i) => i.panelId === "a")).toEqual(item("a", 2, 3, 6, 4));
    expect(lg.map((i) => i.panelId).sort()).toEqual(["a", "b"]);
  });

  it("leaves a complete valid breakpoint out of the patch", () => {
    const stored: DashboardLayout = { ...complete, md: [item("a", 0, 0, 5, 4)] };
    const patch = buildRepairPatch(asPanels(["a", "b"]), {
      ...stored,
      lg: [item("a", 0, 0, 6, 4), item("b", 6, 0, 6, 4)],
    });
    expect(patch.lg).toBeUndefined();
    expect(patch.md).toBeDefined();
  });
});
