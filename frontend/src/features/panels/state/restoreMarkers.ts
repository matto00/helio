// HEL-1783 D3b: the warm-restore marker. A shared dashboard's Output is read through the per-panel routes, so it has no
// metadata-derived run baseline (`isReusable` requires one for an owner's Output), and the status poll that would catch a
// stale window is not running while the tab is away. A `panel` restore therefore marks each window it KEPT: the panel's FIRST
// mount after the restore may reuse that window, and no later mount may (the marker is consumed when that mount fetches, when
// it unmounts, when another dashboard's panels are restored or fetched, and on expiry or logout).
//
// Module-level (not Redux) for the same reason `outputFreshness` is: hooks, thunks and the warm cache reach it without an
// import cycle, and `clearWarmState` can empty it in one place.

import { useEffect, useRef } from "react";

/** dashboard id -> panel id -> the marker's serial. The serial lets a deferred consume (a card's unmount) spend only the marker it
 *  saw, never a later restore's marker for the same panel. */
const markers = new Map<string, Map<string, number>>();
let serial = 0;

/** Marks `panelIds` of `dashboardId` as restored; any other dashboard's markers are dropped (one never outlives its restore). */
export function markRestored(dashboardId: string, panelIds: string[]): void {
  clearRestoreMarkersExcept(dashboardId);
  if (panelIds.length === 0) markers.delete(dashboardId);
  else markers.set(dashboardId, new Map(panelIds.map((id) => [id, ++serial])));
}

/** The serial of `panelId`'s marker, or `undefined` when it holds none. */
export function restoreMarkerSerial(panelId: string): number | undefined {
  for (const ids of markers.values()) {
    const found = ids.get(panelId);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function hasRestoreMarker(panelId: string): boolean {
  return restoreMarkerSerial(panelId) !== undefined;
}

/** Spends `panelId`'s marker; with `onlySerial`, only if it is still that marker. */
export function consumeRestoreMarker(panelId: string, onlySerial?: number): void {
  for (const [dashboardId, ids] of markers) {
    const found = ids.get(panelId);
    if (found === undefined || (onlySerial !== undefined && found !== onlySerial)) continue;
    ids.delete(panelId);
    if (ids.size === 0) markers.delete(dashboardId);
  }
}

/** Drops `dashboardId`'s markers, or every marker when none is given. */
export function clearRestoreMarkers(dashboardId?: string): void {
  if (dashboardId === undefined) markers.clear();
  else markers.delete(dashboardId);
}

export function clearRestoreMarkersExcept(dashboardId: string): void {
  for (const id of [...markers.keys()]) if (id !== dashboardId) markers.delete(id);
}

/** A card's one-mount right to reuse a restored window ends when the card unmounts. Consumed on a 0 ms timer, not in the cleanup
 *  itself: StrictMode's simulated unmount (cleanup, then an immediate re-run of the same effect) is not a real unmount and must not
 *  spend it, so the re-run cancels the timer. The timer spends only the serial held at cleanup, so a later restore of the same
 *  panel is never spent by a late timer. `enabled` is false for hosts that never read the marker. */
export function useConsumeRestoreMarkerOnUnmount(panelId: string, enabled: boolean): void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!enabled) return;
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    return () => {
      const seen = restoreMarkerSerial(panelId);
      if (seen === undefined) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        consumeRestoreMarker(panelId, seen);
      }, 0);
    };
  }, [enabled, panelId]);
}
