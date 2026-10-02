/**
 * `update_dashboard_layout`'s call-routing logic (HEL-1071), zod-free like `placementsHandlers.ts` so
 * a test can exercise it without pulling `write.ts`'s `registerTool` surface into the compile graph.
 *
 * The tool used to flatten one placement into all four breakpoints, so an agent could only repair
 * `xs` by overwriting `lg`/`md`/`sm`. It now sets exactly the breakpoint(s) it names; the backend
 * keeps every other breakpoint as stored and rejects (400, nothing saved) an overlapping or
 * out-of-bounds one, naming the breakpoint and the panel ids — surfaced verbatim by `guarded`.
 */

import type { HelioApi } from "../helioApi.js";
import type { DashboardResponse } from "../types.js";

export type LayoutBreakpoint = "lg" | "md" | "sm" | "xs";

export interface LayoutItem {
  panelId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type BreakpointLayouts = Partial<Record<LayoutBreakpoint, LayoutItem[]>>;

export const LAYOUT_BREAKPOINTS: readonly LayoutBreakpoint[] = ["lg", "md", "sm", "xs"];

export async function updateDashboardLayoutHandler(
  api: HelioApi,
  input: {
    dashboardId: string;
    items?: LayoutItem[];
    breakpoint?: LayoutBreakpoint;
    layouts?: BreakpointLayouts;
  },
): Promise<DashboardResponse> {
  const { dashboardId, items, breakpoint, layouts } = input;
  if ((items === undefined) === (layouts === undefined)) {
    throw new Error("Pass exactly one of `items` (one breakpoint) or `layouts` (per-breakpoint).");
  }
  if (layouts !== undefined && breakpoint !== undefined) {
    throw new Error(
      "`breakpoint` applies to `items`; with `layouts`, name the breakpoints as keys.",
    );
  }
  const named: BreakpointLayouts = items !== undefined ? { [breakpoint ?? "lg"]: items } : layouts!;
  if (LAYOUT_BREAKPOINTS.every((bp) => named[bp] === undefined)) {
    throw new Error("`layouts` must name at least one of lg, md, sm, xs.");
  }
  return api.updateDashboardLayout(dashboardId, named);
}
