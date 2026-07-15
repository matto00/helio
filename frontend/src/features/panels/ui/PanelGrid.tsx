import React, { useImperativeHandle, useRef } from "react";
import { useContainerWidth } from "react-grid-layout";

import type { DashboardLayout } from "../../dashboards/types/dashboard";
import type { Panel } from "../types/panel";
import { DesktopPanelGrid, type DesktopPanelGridHandle } from "./DesktopPanelGrid";
import { MobilePanelStack } from "./MobilePanelStack";
import { panelGridConfig } from "./panelGridConfig";
import "./PanelGrid.css";

export interface PanelGridHandle {
  /** Immediately flush pending panel updates and reset the auto-save timer.
   *  A no-op below the `sm` boundary — see the class doc below. */
  flushAndReset: () => void;
}

interface PanelGridProps {
  dashboardId: string;
  layout: DashboardLayout;
  panels: Panel[];
  zoomLevel?: number;
}

/**
 * Measures the grid container and branches on `panelGridConfig.breakpoints.sm`
 * (768px) — the same width React Grid Layout uses to resolve the `xs`
 * breakpoint. Below it, `<DesktopPanelGrid>` (RGL plus the auto-save wiring)
 * is never mounted; `<MobilePanelStack>` renders instead.
 *
 * This is a structural guarantee, not a rendering preference: the auto-save
 * hook (`usePanelGridSave`, the only path that can dispatch
 * `updateDashboardLayout` / `setLayoutPending`) lives entirely inside
 * `DesktopPanelGrid`. Below the boundary it is never called — there is no
 * code path capable of persisting a layout write from the phone stack. See
 * hazard §4.1 of notes/mobile-pwa-handoff.md (the binding spec).
 */
export const PanelGrid = React.forwardRef<PanelGridHandle, PanelGridProps>(function PanelGrid(
  { dashboardId, layout, panels, zoomLevel = 1.0 },
  ref,
) {
  const { containerRef, width } = useContainerWidth({
    initialWidth: panelGridConfig.initialWidth,
  });
  const desktopHandleRef = useRef<DesktopPanelGridHandle | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      flushAndReset: () => {
        // No-op below the sm boundary: DesktopPanelGridHandle isn't mounted,
        // so there is nothing pending to flush — the stack path never
        // accumulates a layout or panel-appearance write in the first place.
        desktopHandleRef.current?.flushAndReset();
      },
    }),
    [],
  );

  const isPhone = width < panelGridConfig.breakpoints.sm;

  return (
    <div ref={containerRef} className="panel-grid-shell">
      {isPhone ? (
        <MobilePanelStack panels={panels} layout={layout} containerWidth={width} />
      ) : (
        <DesktopPanelGrid
          ref={desktopHandleRef}
          dashboardId={dashboardId}
          layout={layout}
          panels={panels}
          zoomLevel={zoomLevel}
          width={width}
        />
      )}
    </div>
  );
});
