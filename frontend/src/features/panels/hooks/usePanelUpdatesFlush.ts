// Width-independent pending-panel-updates flush lifecycle for `PanelGrid`.
//
// HEL-304: hoisted out of `DesktopPanelGrid` (the former `usePanelGridSave`)
// so pending panel title/appearance edits flush at EVERY container width — the
// mobile stack renders `PanelDetailModal` too, and its producer
// (`accumulatePanelUpdate`) is width-independent. Owns the 30s auto-save
// interval, the dashboard-switch flush + reset, the Save-now registration
// (`SaveStateContext`), and the imperative flush handle.
//
// Layout persistence is deliberately NOT owned here: it stays structurally
// desktop-only in `useLayoutSave` (mounted only by `DesktopPanelGrid`). This
// hook holds a layout-flush *slot* (`layoutFlushRef`) that `useLayoutSave`
// registers into on mount and clears on unmount; `flushAll` invokes it only
// when populated, so below the `sm` boundary (slot empty, stack mounted) no
// `updateDashboardLayout` / `setLayoutPending` write can fire. This preserves
// the HEL-301 xs byte-identity guarantee (hazard §4.1 of
// notes/mobile-pwa-handoff.md, the binding spec).
//
// HEL-306: a layout change staged on desktop but not yet flushed is instead
// persisted by `useLayoutSave`'s own unmount cleanup (not via this slot), so
// the boundary crossing that empties this slot no longer drops the staged edit.
// This slot remains the path for the auto-save tick / "Save now" while the
// desktop grid is mounted; the unmount flush covers the teardown case.

import { useCallback, useEffect, useImperativeHandle, useRef, type Ref } from "react";

import {
  buildBatchRequest,
  clearPendingPanelUpdates,
  resetPanelSaveState,
  updatePanelsBatch,
} from "../state/panelsSlice";
import { useSaveState } from "../../../context/SaveStateContext";
import type { PanelUpdateFields } from "../types/panel";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";

// Exported so the HEL-301 structural no-persist test and the HEL-304 flush
// tests (PanelGrid.test.tsx) can advance fake timers past exactly this interval
// without duplicating the magic number.
export const AUTO_SAVE_INTERVAL_MS = 30_000;

export interface PanelUpdatesFlushHandle {
  /** Immediately flush pending panel updates (and any registered layout flush)
   *  and reset the auto-save timer. */
  flushAndReset: () => void;
}

/** Callback the desktop layout hook registers so a manual "Save now" or an
 *  auto-save tick can persist a pending layout change alongside panel updates.
 *  `null` whenever the desktop grid is unmounted (e.g. below the `sm`
 *  boundary), which keeps layout writes structurally desktop-only. */
export type LayoutFlush = (() => void) | null;

export interface UsePanelUpdatesFlushResult {
  /** Register/unregister the desktop layout-flush callback. Pass `null` on
   *  unmount so no layout-write path survives the shell swap. */
  registerLayoutFlush: (fn: LayoutFlush) => void;
}

interface UsePanelUpdatesFlushOptions {
  dashboardId: string;
  forwardedRef: Ref<PanelUpdatesFlushHandle>;
}

export function usePanelUpdatesFlush({
  dashboardId,
  forwardedRef,
}: UsePanelUpdatesFlushOptions): UsePanelUpdatesFlushResult {
  const dispatch = useAppDispatch();

  const panelFlushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const layoutFlushRef = useRef<LayoutFlush>(null);

  const pendingPanelUpdates = useAppSelector((state) => state.panels.pendingPanelUpdates);
  // Keep a ref so the interval callback always reads the latest value without
  // re-registering.
  const pendingPanelUpdatesRef = useRef<Record<string, PanelUpdateFields>>(pendingPanelUpdates);
  useEffect(() => {
    pendingPanelUpdatesRef.current = pendingPanelUpdates;
  });

  const registerLayoutFlush = useCallback((fn: LayoutFlush) => {
    layoutFlushRef.current = fn;
  }, []);

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

  /** Flush pending panel updates and, when the desktop grid is mounted, any
   *  pending layout change (via the registered slot). */
  const flushAll = useCallback(() => {
    flushPanelUpdates();
    layoutFlushRef.current?.();
  }, [flushPanelUpdates]);

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
    panelFlushTimerRef.current = setInterval(flushAll, AUTO_SAVE_INTERVAL_MS);
  }, [dashboardId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Register the flush+reset function with the context so AppShell's "Save now"
  // can invoke it — at every viewport width, not only when the desktop grid is
  // mounted.
  const { registerFlush } = useSaveState();
  useEffect(() => {
    registerFlush(flushAndReset);
    return () => registerFlush(null);
  }, [registerFlush, flushAndReset]);

  // Expose an imperative handle for callers with a ref.
  useImperativeHandle(forwardedRef, () => ({ flushAndReset }), [flushAndReset]);

  return { registerLayoutFlush };
}
