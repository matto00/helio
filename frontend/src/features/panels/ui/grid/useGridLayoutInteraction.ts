// Drag/resize interaction and layout-change handling for `DesktopPanelGrid` (HEL-1418 split;
// behaviour unchanged).
//
// This hook never imports `useLayoutSave` (HEL-301 hazard §4.1: it is called only from
// `DesktopPanelGrid.tsx`). The component calls `useLayoutSave` and hands its outputs in here as
// plain arguments; this hook must be called AFTER `useLayoutSave` (it has no effects of its own,
// so the order only fixes where its handlers' inputs come from).

import React, { useCallback, useRef, useState, type MutableRefObject } from "react";
import type { Responsive } from "react-grid-layout";
import { getBreakpointFromWidth } from "react-grid-layout/core";

import {
  areDashboardLayoutsEqual,
  type DashboardLayoutBreakpoint,
} from "../../../dashboards/state/dashboardLayout";
import { setDashboardLayoutLocally } from "../../../dashboards/state/dashboardsSlice";
import type { DashboardLayout } from "../../../dashboards/types/dashboard";
import { useAppDispatch } from "../../../../hooks/reduxHooks";
import { pushLayoutSnapshot } from "../../../layout/state/layoutHistorySlice";
import type { Panel } from "../../types/panel";
import { itemsFromRglLayout, rglBreakpoints } from "./panelGridConfig";

type LayoutChangeHandler = NonNullable<React.ComponentProps<typeof Responsive>["onLayoutChange"]>;

interface GridLayoutInteractionArgs {
  dashboardId: string;
  layout: DashboardLayout;
  resolvedLayout: DashboardLayout;
  panels: Panel[];
  width: number;
  latestLayoutRef: MutableRefObject<DashboardLayout>;
  markLayoutChanged: (next: DashboardLayout) => void;
  commitInteractionLayout: (next: DashboardLayout) => DashboardLayout;
  commitOnNextLayoutChangeRef: MutableRefObject<boolean>;
  clearCommitFlag: () => void;
  armCommitFlag: () => void;
}

export function useGridLayoutInteraction({
  dashboardId,
  layout,
  resolvedLayout,
  panels,
  width,
  latestLayoutRef,
  markLayoutChanged,
  commitInteractionLayout,
  commitOnNextLayoutChangeRef,
  clearCommitFlag,
  armCommitFlag,
}: GridLayoutInteractionArgs) {
  const dispatch = useAppDispatch();
  const [isDragging, setIsDragging] = useState(false);
  const preInteractionLayoutRef = useRef<DashboardLayout | null>(null);

  const handleDragStart = useCallback(() => {
    clearCommitFlag();
    setIsDragging(true);
    preInteractionLayoutRef.current = latestLayoutRef.current;
  }, [latestLayoutRef, clearCommitFlag]);

  const handleDragStop = useCallback(() => {
    setIsDragging(false);
    if (preInteractionLayoutRef.current !== null) {
      dispatch(
        pushLayoutSnapshot({
          dashboardId,
          layout: preInteractionLayoutRef.current,
        }),
      );
      preInteractionLayoutRef.current = null;
    }
    armCommitFlag();
  }, [dashboardId, dispatch, armCommitFlag]);

  const handleResizeStart = useCallback(() => {
    clearCommitFlag();
    preInteractionLayoutRef.current = latestLayoutRef.current;
  }, [latestLayoutRef, clearCommitFlag]);

  const handleResizeStop = useCallback(() => {
    if (preInteractionLayoutRef.current !== null) {
      dispatch(
        pushLayoutSnapshot({
          dashboardId,
          layout: preInteractionLayoutRef.current,
        }),
      );
      preInteractionLayoutRef.current = null;
    }
    armCommitFlag();
  }, [dashboardId, dispatch, armCommitFlag]);

  const handleLayoutChange = useCallback<LayoutChangeHandler>(
    (currentLayout) => {
      if (currentLayout === undefined) return;
      // HEL-1023: RGL also calls this on mount and on every breakpoint change with exactly the layout
      // it was fed, and that layout may be derived/repaired at render. Only a layout that DIFFERS
      // from what we resolved is a user edit, and an edit rewrites the active breakpoint alone; a
      // view hands the store layout straight back, so it never arms pending, history or a PATCH.
      const bp = getBreakpointFromWidth(rglBreakpoints, width) as DashboardLayoutBreakpoint;
      const items = itemsFromRglLayout(panels, currentLayout);
      const edited = { ...resolvedLayout, [bp]: items };
      // HEL-1457: stored items of panels this tab has not loaded are kept, so rebuilding the breakpoint from the
      // loaded panels can never drop another writer's item.
      const loaded = new Set(panels.map((p) => p.id));
      const kept = layout[bp].filter((item) => !loaded.has(item.panelId));
      const next = areDashboardLayoutsEqual(edited, resolvedLayout)
        ? layout
        : { ...layout, [bp]: [...items, ...kept] };
      markLayoutChanged(next);
      if (commitOnNextLayoutChangeRef.current) {
        clearCommitFlag();
        if (!areDashboardLayoutsEqual(next, layout)) {
          dispatch(
            setDashboardLayoutLocally({ dashboardId, layout: commitInteractionLayout(next) }),
          );
        }
      }
    },
    [
      markLayoutChanged,
      panels,
      width,
      layout,
      clearCommitFlag,
      commitOnNextLayoutChangeRef,
      resolvedLayout,
      dispatch,
      dashboardId,
      commitInteractionLayout,
    ],
  );

  return {
    isDragging,
    handleDragStart,
    handleDragStop,
    handleResizeStart,
    handleResizeStop,
    handleLayoutChange,
  };
}
