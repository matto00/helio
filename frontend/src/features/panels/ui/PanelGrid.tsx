import React from "react";
import { useContainerWidth } from "react-grid-layout";

import type { DashboardLayout } from "../../dashboards/types/dashboard";
import type { Panel } from "../types/panel";
import { DesktopPanelGrid } from "./DesktopPanelGrid";
import { MobilePanelStack } from "./MobilePanelStack";
import { usePanelUpdatesFlush, type PanelUpdatesFlushHandle } from "../hooks/usePanelUpdatesFlush";
import { panelGridConfig } from "./panelGridConfig";
import "./PanelGrid.css";

export type PanelGridHandle = PanelUpdatesFlushHandle;

interface PanelGridProps {
  dashboardId: string;
  layout: DashboardLayout;
  panels: Panel[];
  zoomLevel?: number;
}

/**
 * Measures the grid container and branches on `panelGridConfig.breakpoints.sm`
 * (768px) — the same width React Grid Layout uses to resolve the `xs`
 * breakpoint. Below it, `<DesktopPanelGrid>` (RGL plus layout persistence) is
 * never mounted; `<MobilePanelStack>` renders instead.
 *
 * HEL-304: the pending-panel-updates flush (`usePanelUpdatesFlush`) is owned
 * here, so it runs at EVERY width — panel title/appearance edits staged in the
 * detail modal below the boundary flush via the batch endpoint exactly like
 * desktop, and "Save now" is functional on the phone stack.
 *
 * Layout persistence stays a structural desktop-only guarantee: the only path
 * that can dispatch `updateDashboardLayout` / `setLayoutPending`
 * (`useLayoutSave`) lives entirely inside `DesktopPanelGrid`. It registers its
 * `persistLayout` into this hook's flush slot on mount and clears it on
 * unmount, so below the boundary the slot is empty and there is no code path
 * capable of persisting a layout write from the phone stack. See hazard §4.1
 * of notes/mobile-pwa-handoff.md (the binding spec).
 */
export const PanelGrid = React.forwardRef<PanelGridHandle, PanelGridProps>(function PanelGrid(
  { dashboardId, layout, panels, zoomLevel = 1.0 },
  ref,
) {
  const { containerRef, width } = useContainerWidth({
    initialWidth: panelGridConfig.initialWidth,
  });
  const { registerLayoutFlush } = usePanelUpdatesFlush({ dashboardId, forwardedRef: ref });

  const isPhone = width < panelGridConfig.breakpoints.sm;

  return (
    <div ref={containerRef} className="panel-grid-shell">
      {isPhone ? (
        <MobilePanelStack panels={panels} layout={layout} containerWidth={width} />
      ) : (
        <DesktopPanelGrid
          dashboardId={dashboardId}
          layout={layout}
          panels={panels}
          zoomLevel={zoomLevel}
          width={width}
          registerLayoutFlush={registerLayoutFlush}
        />
      )}
    </div>
  );
});
