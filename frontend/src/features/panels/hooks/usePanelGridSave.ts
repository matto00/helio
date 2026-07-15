// Auto-save / flush-and-reset wiring for `PanelGrid`.
//
// Extracted from `PanelGrid.tsx` so the grid stays under the file-size cap.
// Owns the 30s flush interval, the latest-layout / persisted-layout / in-
// flight-layout refs, and the imperative "save now" surface exposed via
// the `useSaveState` context plus the optional ref handle.

import * as React from "react";
import { useCallback, useEffect, useImperativeHandle, useRef, type Ref } from "react";

import { areDashboardLayoutsEqual } from "../../dashboards/state/dashboardLayout";
import { setLayoutPending, updateDashboardLayout } from "../../dashboards/state/dashboardsSlice";
import {
  buildBatchRequest,
  clearPendingPanelUpdates,
  resetPanelSaveState,
  updatePanelsBatch,
} from "../state/panelsSlice";
import { useSaveState } from "../../../context/SaveStateContext";
import type { DashboardLayout } from "../../dashboards/types/dashboard";
import type { PanelUpdateFields } from "../types/panel";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";

// Exported so the HEL-301 structural no-persist test (PanelGrid.test.tsx)
// can advance fake timers past exactly this interval without duplicating the
// magic number.
export const AUTO_SAVE_INTERVAL_MS = 30_000;

export interface PanelGridSaveHandle {
  /** Immediately flush pending panel updates and reset the auto-save timer. */
  flushAndReset: () => void;
}

export interface UsePanelGridSaveResult {
  /** Latest layout ref — the grid's RGL `onDragStart` / `onResizeStart`
   *  reads this to snapshot the pre-interaction layout for undo. */
  latestLayoutRef: React.MutableRefObject<DashboardLayout>;
  /** Push a layout change into the auto-save pipeline (no immediate POST). */
  markLayoutChanged: (next: DashboardLayout) => void;
}

interface UsePanelGridSaveOptions {
  dashboardId: string;
  resolvedLayout: DashboardLayout;
  forwardedRef: Ref<PanelGridSaveHandle>;
}

export function usePanelGridSave({
  dashboardId,
  resolvedLayout,
  forwardedRef,
}: UsePanelGridSaveOptions): UsePanelGridSaveResult {
  const dispatch = useAppDispatch();
  const latestLayoutRef = useRef<DashboardLayout>(
    resolvedLayout,
  ) as React.MutableRefObject<DashboardLayout>;
  const persistedLayoutRef = useRef<DashboardLayout>(
    resolvedLayout,
  ) as React.MutableRefObject<DashboardLayout>;
  const inFlightLayoutRef = useRef<DashboardLayout | null>(null);
  // Tracks whether we've already dispatched setLayoutPending(true) for the
  // current pending cycle, so a drag (which fires onLayoutChange every tick)
  // dispatches once on the false→true transition instead of every frame.
  // Reset when the layout syncs back to persisted (see resolvedLayout effect).
  const layoutPendingDispatchedRef = useRef(false);
  const panelFlushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingPanelUpdates = useAppSelector((state) => state.panels.pendingPanelUpdates);
  // Keep a ref so the interval callback always reads the latest value
  // without re-registering.
  const pendingPanelUpdatesRef = useRef<Record<string, PanelUpdateFields>>(pendingPanelUpdates);
  useEffect(() => {
    pendingPanelUpdatesRef.current = pendingPanelUpdates;
  });

  useEffect(() => {
    latestLayoutRef.current = resolvedLayout;
    persistedLayoutRef.current = resolvedLayout;
    // Layout is now in sync with what's persisted, so the pending cycle is
    // over — allow the next real change to re-dispatch setLayoutPending(true).
    layoutPendingDispatchedRef.current = false;
    if (
      inFlightLayoutRef.current !== null &&
      areDashboardLayoutsEqual(inFlightLayoutRef.current, resolvedLayout)
    ) {
      inFlightLayoutRef.current = null;
    }
  }, [resolvedLayout]);

  const persistLayout = useCallback(() => {
    const nextLayout = latestLayoutRef.current;
    if (areDashboardLayoutsEqual(nextLayout, persistedLayoutRef.current)) {
      return;
    }
    if (
      inFlightLayoutRef.current !== null &&
      areDashboardLayoutsEqual(nextLayout, inFlightLayoutRef.current)
    ) {
      return;
    }

    inFlightLayoutRef.current = nextLayout;
    void dispatch(updateDashboardLayout({ dashboardId, layout: nextLayout }))
      .unwrap()
      .catch(() => {
        // Keep local drag UX responsive; retry happens on the next layout change.
      })
      .finally(() => {
        if (
          inFlightLayoutRef.current !== null &&
          areDashboardLayoutsEqual(inFlightLayoutRef.current, nextLayout)
        ) {
          inFlightLayoutRef.current = null;
        }
      });
  }, [dashboardId, dispatch]);

  /** Flush all pending panel updates immediately. Shared by the interval and "Save now". */
  const flushPanelUpdates = useCallback(() => {
    const pending = pendingPanelUpdatesRef.current;
    if (Object.keys(pending).length === 0) return;
    void dispatch(updatePanelsBatch(buildBatchRequest(pending)))
      .unwrap()
      .then(() => {
        dispatch(clearPendingPanelUpdates());
      })
      .catch(() => {
        // Network or server error — retain pending updates; next interval tick retries
      });
  }, [dispatch]);

  /** Flush both pending panel updates and any pending layout change. */
  const flushAll = useCallback(() => {
    flushPanelUpdates();
    persistLayout();
  }, [flushPanelUpdates, persistLayout]);

  /** Flush immediately and reset the 30-second auto-save timer. */
  const flushAndReset = useCallback(() => {
    flushAll();
    if (panelFlushTimerRef.current !== null) {
      clearInterval(panelFlushTimerRef.current);
    }
    panelFlushTimerRef.current = setInterval(flushAll, AUTO_SAVE_INTERVAL_MS);
  }, [flushAll]);

  // Start the auto-save interval on mount; cancel on unmount.
  useEffect(() => {
    panelFlushTimerRef.current = setInterval(flushAll, AUTO_SAVE_INTERVAL_MS);
    return () => {
      if (panelFlushTimerRef.current !== null) {
        clearInterval(panelFlushTimerRef.current);
        panelFlushTimerRef.current = null;
      }
    };
  }, [flushAll]);

  // Reset save state when the user switches dashboards.
  const isFirstRenderRef = useRef(true);
  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    flushPanelUpdates();
    dispatch(resetPanelSaveState());
    if (panelFlushTimerRef.current !== null) {
      clearInterval(panelFlushTimerRef.current);
    }
    panelFlushTimerRef.current = setInterval(flushPanelUpdates, AUTO_SAVE_INTERVAL_MS);
  }, [dashboardId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Register the flush+reset function with the context so AppShell can invoke it.
  const { registerFlush } = useSaveState();
  useEffect(() => {
    registerFlush(flushAndReset);
    return () => registerFlush(null);
  }, [registerFlush, flushAndReset]);

  // Expose an imperative handle for callers with a ref.
  useImperativeHandle(forwardedRef, () => ({ flushAndReset }), [flushAndReset]);

  const markLayoutChanged = useCallback(
    (next: DashboardLayout) => {
      latestLayoutRef.current = next;
      if (
        !areDashboardLayoutsEqual(next, persistedLayoutRef.current) &&
        !layoutPendingDispatchedRef.current
      ) {
        layoutPendingDispatchedRef.current = true;
        dispatch(setLayoutPending(true));
      }
    },
    [dispatch],
  );

  return { latestLayoutRef, markLayoutChanged };
}
