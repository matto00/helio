// Adopts the layout items the server stored for a panel it just created or duplicated (HEL-1260;
// HEL-1230 class 3, a placement extension). The server appends one item per breakpoint below that
// breakpoint's own bottom and returns them in `layouts`; the client appends exactly those to its own
// breakpoint arrays (HEL-1071: never project the lg item into md/sm/xs, which collapses columns into
// the same cell). It must run BEFORE the panel list is refetched, so the owner repair never sees a
// live panel without an item.

import type { Dispatch } from "@reduxjs/toolkit";

import { setDashboardLayoutLocally } from "../../dashboards/state/dashboardsSlice";
import type { RootState } from "../../../store/store";
import type { Panel } from "../types/panel";

export function adoptPlacedLayouts(
  dispatch: Dispatch,
  getState: () => RootState,
  dashboardId: string,
  created: Panel,
): void {
  const placed = created.layouts;
  if (!placed) return;
  const dashboard = getState().dashboards.items.find((d) => d.id === dashboardId);
  if (!dashboard) return;
  const withPanel = (bp: keyof typeof placed) =>
    dashboard.layout[bp].some((item) => item.panelId === created.id)
      ? dashboard.layout[bp]
      : [...dashboard.layout[bp], { panelId: created.id, ...placed[bp] }];
  dispatch(
    setDashboardLayoutLocally({
      dashboardId,
      layout: {
        lg: withPanel("lg"),
        md: withPanel("md"),
        sm: withPanel("sm"),
        xs: withPanel("xs"),
      },
    }),
  );
}
