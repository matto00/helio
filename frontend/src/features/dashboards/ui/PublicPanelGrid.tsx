// HEL-1587 design D3 -- the READ-ONLY grid of the public share viewer, for a container >= `panelGridConfig.breakpoints.sm`.
//
// Built from the signed-in grid's own configuration (`rglBreakpoints`, `panelGridConfig`, `gridMetrics`, `createLayouts`,
// `resolveDashboardLayout`, `panelMinRows`) but deliberately NOT from `PanelGrid`/`DesktopPanelGrid`: those carry the
// layout-save, staged-edit and `useStoredLayoutRepair` machinery, which must never run on a public path, even when the
// viewing session is the dashboard's owner. Nothing here imports `useLayoutSave`, `useStoredLayoutRepair` or
// `updateDashboardLayout`, so no layout save or repair request can be sent.
//
// `noCompactor` (as `DesktopPanelGrid` uses): react-grid-layout's default vertical compactor would pull panels up and erase
// the vertical gaps `resolveDashboardLayout` keeps on purpose.

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import { useMemo } from "react";
import { Responsive } from "react-grid-layout";
import { getBreakpointFromWidth, noCompactor } from "react-grid-layout/core";

import { useDensity } from "../../../theme/ThemeProvider";
import { resolveDashboardLayout } from "../state/dashboardLayout";
import type { DashboardLayout } from "../types/dashboard";
import type { Panel } from "../../panels/types/panel";
import {
  createLayouts,
  gridMetrics,
  panelGridConfig,
  panelMinRows,
  rglBreakpoints,
} from "../../panels/ui/grid/panelGridConfig";
import { useProcessedWidth } from "../../panels/ui/grid/useProcessedWidth";
import "../../panels/ui/grid/PanelGrid.css";
import { PublicPanelBody, PublicPanelTitleRow } from "./PublicPanelBody";

interface PublicPanelGridProps {
  dashboardId: string;
  token: string;
  panels: Panel[];
  layout: DashboardLayout;
  /** The viewer container's measured width. */
  width: number;
}

export function PublicPanelGrid({
  dashboardId,
  token,
  panels,
  layout,
  width,
}: PublicPanelGridProps) {
  const resolvedLayout = useMemo(() => resolveDashboardLayout(panels, layout), [layout, panels]);
  const layouts = useMemo(() => {
    const byId = new Map(panels.map((panel) => [panel.id, panel]));
    return createLayouts(resolvedLayout, (panelId, h) => panelMinRows(byId.get(panelId), h));
  }, [resolvedLayout, panels]);
  const activeBreakpoint = getBreakpointFromWidth(rglBreakpoints, width) as keyof DashboardLayout;
  // Cells at the minimum height take the tighter vertical rhythm (`PanelGrid.css` `data-short-card`), as the signed-in grid.
  const shortCardIds = useMemo(
    () =>
      new Set(
        resolvedLayout[activeBreakpoint]
          .filter((item) => item.h <= panelGridConfig.itemHeights.min)
          .map((item) => item.panelId),
      ),
    [resolvedLayout, activeBreakpoint],
  );
  const { gridStyle, handleWidthChange } = useProcessedWidth(width);
  const metrics = gridMetrics(useDensity());

  return (
    <Responsive
      // Keyed by dashboard. The layout and the measured width arrive in one render here, so a breakpoint change needs no
      // remount (the skeleton's HEL-1835 breakpoint key exists for a layout that arrives after the width), and a remount
      // would leave `useProcessedWidth` at the previous width: RGL reports `onWidthChange` only for a width CHANGE.
      key={dashboardId}
      className="panel-grid public-dashboard-viewer__grid"
      width={width}
      style={gridStyle}
      onWidthChange={handleWidthChange}
      layouts={layouts}
      breakpoints={rglBreakpoints}
      cols={panelGridConfig.cols}
      rowHeight={metrics.rowHeight}
      margin={metrics.margin}
      containerPadding={panelGridConfig.containerPadding}
      dragConfig={{ enabled: false }}
      resizeConfig={{ enabled: false }}
      compactor={noCompactor}
    >
      {panels.map((panel) => (
        <div
          key={panel.id}
          data-panel-id={panel.id}
          data-short-card={shortCardIds.has(panel.id) ? "" : undefined}
        >
          <section
            className="panel-grid-card public-dashboard-viewer__card"
            aria-label={panel.title}
          >
            <PublicPanelTitleRow
              panel={panel}
              dashboardId={dashboardId}
              token={token}
              headingLevel="h2"
            />
            <div className="public-dashboard-viewer__card-body">
              <PublicPanelBody panel={panel} dashboardId={dashboardId} token={token} />
            </div>
          </section>
        </div>
      ))}
    </Responsive>
  );
}
