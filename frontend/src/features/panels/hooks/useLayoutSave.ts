// Desktop-only layout persistence for `DesktopPanelGrid`.
//
// HEL-304: the layout half of the former `usePanelGridSave`. Called ONLY from
// `DesktopPanelGrid`, so `updateDashboardLayout` / `setLayoutPending` remain
// unreachable below the `sm` boundary (the mobile stack never mounts this) —
// preserving the HEL-301 xs byte-identity guarantee (hazard §4.1 of
// notes/mobile-pwa-handoff.md, the binding spec). On mount it registers
// `persistLayout` into the parent's width-independent flush slot
// (`registerLayoutFlush`) so a manual "Save now" or auto-save tick persists a
// pending layout change; on unmount it clears the slot, so crossing below the
// boundary leaves no layout-write path (a pure resize never PATCHes layout).
//
// HEL-306: it also flushes any staged-but-unpersisted layout change in its own
// unmount cleanup, so a desktop-staged drag/resize survives DesktopPanelGrid
// unmounting for any reason — the window shrinking below the `sm` boundary
// (`PanelList.tsx` keys `<PanelGrid>` by `selectedDashboardId`, so a dashboard
// switch is likewise a true remount), or route navigation. This does NOT weaken
// the HEL-301 guarantee: the flush runs in this desktop-only hook's teardown on
// desktop-staged data only, and `persistLayout`'s equality guard makes a
// browse-only crossing (no staged change) a no-op — the mobile stack still
// mounts no layout-write path.

import { useCallback, useEffect, useRef, type MutableRefObject } from "react";

import { areDashboardLayoutsEqual } from "../../dashboards/state/dashboardLayout";
import { setLayoutPending, updateDashboardLayout } from "../../dashboards/state/dashboardsSlice";
import type { DashboardLayout } from "../../dashboards/types/dashboard";
import type { LayoutFlush } from "./usePanelUpdatesFlush";
import { useAppDispatch } from "../../../hooks/reduxHooks";

export interface UseLayoutSaveResult {
  /** Latest layout ref — the grid's RGL `onDragStart` / `onResizeStart`
   *  reads this to snapshot the pre-interaction layout for undo. */
  latestLayoutRef: MutableRefObject<DashboardLayout>;
  /** Push a layout change into the auto-save pipeline (no immediate POST). */
  markLayoutChanged: (next: DashboardLayout) => void;
}

interface UseLayoutSaveOptions {
  dashboardId: string;
  resolvedLayout: DashboardLayout;
  registerLayoutFlush: (fn: LayoutFlush) => void;
}

export function useLayoutSave({
  dashboardId,
  resolvedLayout,
  registerLayoutFlush,
}: UseLayoutSaveOptions): UseLayoutSaveResult {
  const dispatch = useAppDispatch();
  const latestLayoutRef = useRef<DashboardLayout>(resolvedLayout);
  const persistedLayoutRef = useRef<DashboardLayout>(resolvedLayout);
  const inFlightLayoutRef = useRef<DashboardLayout | null>(null);
  // Tracks whether we've already dispatched setLayoutPending(true) for the
  // current pending cycle, so a drag (which fires onLayoutChange every tick)
  // dispatches once on the false→true transition instead of every frame.
  // Reset when the layout syncs back to persisted (see resolvedLayout effect).
  const layoutPendingDispatchedRef = useRef(false);

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

  // Register persistLayout into the parent's flush slot while mounted; clear it
  // on unmount so no layout-write path survives the shell swap below `sm`.
  useEffect(() => {
    registerLayoutFlush(persistLayout);
    return () => registerLayoutFlush(null);
  }, [registerLayoutFlush, persistLayout]);

  // HEL-306: keep the latest persistLayout in a ref and flush it exactly once at
  // true unmount. Kept in a ref (updated every render, no dependency array — the
  // usePanelUpdatesFlush latest-ref pattern) so the unmount effect can stay
  // empty-dep: its cleanup fires only when DesktopPanelGrid actually unmounts
  // (boundary crossing or dashboard switch), not on every persistLayout identity
  // change. Flushing directly (not via the parent slot) means teardown order
  // between this effect and the slot-clear effect above is irrelevant. The
  // equality + in-flight guards inside persistLayout make a flush with no staged
  // change a no-op, so a browse-only crossing dispatches nothing.
  const persistLayoutRef = useRef(persistLayout);
  useEffect(() => {
    persistLayoutRef.current = persistLayout;
  });
  useEffect(() => () => persistLayoutRef.current(), []);

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
