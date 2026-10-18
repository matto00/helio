import type { Panel } from "../types/panel";
import { panelsMatchDashboard } from "./panelsSlice";

/** The slice of panels state the settledness predicates read. */
interface PanelsSettledInput {
  items: Panel[];
  loadedDashboardId: string | null;
  status: "idle" | "loading" | "succeeded" | "failed";
  staleDashboardId: string | null;
}

/** True once the panels in the store are the answer for `dashboardId`: they belong to it, or its fetch succeeded with
 *  none. `fetchPanels.pending` sets `loadedDashboardId` at once and keeps the previous `items`, so
 *  `loadedDashboardId === id` alone is true for the whole skeleton window; this is the positive check that is not.
 *  The expression `App.tsx` uses to decide the off-route `OutputPicker` may read `items` (HEL-1646 extracted it). */
export function panelsSettledFor(panels: PanelsSettledInput, dashboardId: string | null): boolean {
  return (
    dashboardId !== null &&
    (panelsMatchDashboard(panels.items, dashboardId) ||
      (panels.items.length === 0 &&
        panels.loadedDashboardId === dashboardId &&
        panels.status === "succeeded"))
  );
}

/** `panelsSettledFor`, plus the known-empty state after the last panel was deleted: `markDashboardPanelsStale` leaves
 *  `idle` / `staleDashboardId === id` / `items: []` and no refetch follows (the same state `PanelList` renders the zero
 *  panel empty state from). The refreshed-line slot and the pipeline-fed flag sync decide on this, never on
 *  `panelsSettledFor`, so deleting the last output panel does not leave a slot above "No panels yet". */
export function panelsKnownFor(panels: PanelsSettledInput, dashboardId: string | null): boolean {
  return (
    panelsSettledFor(panels, dashboardId) ||
    (dashboardId !== null &&
      panels.items.length === 0 &&
      panels.status === "idle" &&
      panels.staleDashboardId === dashboardId)
  );
}
