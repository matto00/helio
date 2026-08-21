import React from "react";

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
  /** HEL-528 skeptic-final-1.md CR1 — the grid container's measured width,
   *  now owned by `PanelList` (the only consumer of both this and
   *  `PanelGridSkeleton`) instead of a `useContainerWidth()` call local to
   *  this component. Two independent measurements — one here, one in the
   *  skeleton — each started fresh at `panelGridConfig.initialWidth` (1280),
   *  so the instant the skeleton unmounted and this component mounted, RGL
   *  painted one frame at 1280 against a real ~1152px container before its
   *  own effect corrected it a frame later: a visible arrive-wide-then-settle
   *  shift on the very swap this ticket exists to make seamless. A single,
   *  already-settled width shared by both branches removes the remount
   *  entirely. See `PanelList.tsx`'s `useContainerWidth` call. */
  width: number;
}

/**
 * Branches on `panelGridConfig.breakpoints.sm` (768px) — the same width React
 * Grid Layout uses to resolve the `xs` breakpoint — using the container width
 * `PanelList` measures and passes down (see the `width` prop doc). Below the
 * breakpoint, `<DesktopPanelGrid>` (RGL plus layout persistence) is never
 * mounted; `<MobilePanelStack>` renders instead.
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
  { dashboardId, layout, panels, zoomLevel = 1.0, width },
  ref,
) {
  const { registerLayoutFlush } = usePanelUpdatesFlush({ dashboardId, forwardedRef: ref });

  const isPhone = width < panelGridConfig.breakpoints.sm;

  return (
    <div className="panel-grid-shell">
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
