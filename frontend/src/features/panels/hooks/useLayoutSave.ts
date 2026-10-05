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
//
// HEL-1230 — STORE-LAYOUT CLASSIFICATION CONTRACT (HEL-1233 builds on this; keep it accurate).
// Persistence is DEFERRED, never per-edit: nothing below PATCHes by itself. A pending layout is
// flushed by the 30s auto-save tick, Save now, or this hook's unmount flush (`usePanelUpdatesFlush.ts`
// owns the tick/Save-now slot). There is no 250ms layout debounce anywhere.
// Every change of the store's authored `layout` is classified in this order:
//   1. interaction commit  — a drag/resize stop wrote it (`commitInteractionLayout`):  keep baseline
//   2. history traversal   — an undo/redo wrote it (revision changed AND layout equals the history
//      slice's `applied` layout, so a no-op traversal's stale revision can never match): keep baseline
//   3. placement extension — a panel create or duplicate appended items to every breakpoint with the previous store
//      layout as an exact prefix (`layoutPlacement.ts`): extend the baseline by the same items, so a
//      pending edit survives the create and a create alone is not pending
//   4. anything else       — server/external truth (fetch, upsert, PATCH response, the owner's
//      stored-layout repair response — HEL-1233): re-baseline
// Cases 1-3 then set pending = (layout differs from the baseline); case 4 clears it. An undo/redo is
// therefore "a local edit like a drag", persisted by the same flush.
// The owner's one-time stored-layout repair (`useStoredLayoutRepair`, `repairDashboardLayout`) is not an
// interaction commit (no local commit equals it) and not a traversal (revision unchanged), and it
// lands as one of two shapes with the SAME outcome. The reducer adopts its response only while the
// store still equals the layout the repair was computed from, so a response arriving during a pending
// local edit is never adopted. (a) A repair that only appends panels orphaned in EVERY breakpoint, with
// the previous layout an exact prefix, is a placement extension (class 3): the baseline is extended by
// exactly those items, which is the new layout. (b) Anything else (a stored-bad breakpoint repaired by
// moving or dropping items, a stale entry dropped, a panel orphaned in only some breakpoints, or the
// client's panel order differing from the stored order) is class 4 and re-baselines. Either way pending
// stays false, no history entry is added (history comes only from drag/resize/undo), the baseline
// becomes the repaired layout, and a later drag persists normally.
// D5: a PATCH response never overwrites a newer local layout (see `dashboardsSlice`'s fulfilled
// reducer); `persistLayout`'s `.then` then recomputes pending against the server baseline. Known,
// accepted race: if a panel create lands while a PATCH is in flight and the server handled the PATCH
// BEFORE the create, the response baseline lacks the placement, so this pure create is marked pending
// and the next flush sends one redundant (idempotent) PATCH. Pinned by a test in
// `DesktopPanelGrid.inflightResponse.test.tsx`.

import { useCallback, useEffect, useRef, type MutableRefObject } from "react";

import {
  areDashboardLayoutsEqual,
  resolveDashboardLayout,
} from "../../dashboards/state/dashboardLayout";
import { buildLayoutPatch } from "../../dashboards/state/layoutPatch";
import { setLayoutPending, updateDashboardLayout } from "../../dashboards/state/dashboardsSlice";
import type { DashboardLayout } from "../../dashboards/types/dashboard";
import type { Panel } from "../types/panel";
import type { LayoutFlush } from "./usePanelUpdatesFlush";
import { selectAppliedLayout, selectLayoutRevision } from "../../layout/state/layoutHistorySlice";
import { detectPlacementExtension, extendBaseline } from "./layoutPlacement";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";

export interface UseLayoutSaveResult {
  /** Latest layout ref — the grid's RGL `onDragStart` / `onResizeStart`
   *  reads this to snapshot the pre-interaction layout for undo. */
  latestLayoutRef: MutableRefObject<DashboardLayout>;
  /** Push a layout change into the auto-save pipeline (no immediate POST). */
  markLayoutChanged: (next: DashboardLayout) => void;
  /** HEL-1028: record `next` as a local interaction commit about to be written
   *  to the store, so the store echo stays "dirty" (unpersisted) instead of
   *  being re-baselined as persisted. Returns `next` for the caller to dispatch. */
  commitInteractionLayout: (next: DashboardLayout) => DashboardLayout;
}

interface UseLayoutSaveOptions {
  dashboardId: string;
  /** The AUTHORED (store-shaped) layout, never the render-time resolved one (HEL-1023): the
   *  persisted baseline, undo snapshots and the interaction-commit equality all live in this shape,
   *  so a derived or repaired breakpoint is never mistaken for an edit and never written on view. */
  layout: DashboardLayout;
  /** The dashboard's panels and whether that list is loaded: a changed-and-invalid breakpoint is
   *  replaced by its render-time resolution only when they are (HEL-1071, see `buildLayoutPatch`). */
  panels: Panel[];
  panelsLoaded: boolean;
  registerLayoutFlush: (fn: LayoutFlush) => void;
}

export function useLayoutSave({
  dashboardId,
  layout,
  panels,
  panelsLoaded,
  registerLayoutFlush,
}: UseLayoutSaveOptions): UseLayoutSaveResult {
  const dispatch = useAppDispatch();
  const panelsRef = useRef({ panels, panelsLoaded });
  useEffect(() => {
    panelsRef.current = { panels, panelsLoaded };
  });
  const latestLayoutRef = useRef<DashboardLayout>(layout);
  const persistedLayoutRef = useRef<DashboardLayout>(layout);
  const inFlightLayoutRef = useRef<DashboardLayout | null>(null);
  // Tracks whether we've already dispatched setLayoutPending(true) for the
  // current pending cycle, so a drag (which fires onLayoutChange every tick)
  // dispatches once on the false→true transition instead of every frame.
  // Reset when the layout syncs back to the persisted layout.
  const layoutPendingDispatchedRef = useRef(false);
  // HEL-1028: the interaction layout committed to the store at drag/resize stop,
  // and the undo/redo revision last seen — the two local edits whose store echo
  // must NOT be re-baselined as persisted.
  const localCommitRef = useRef<DashboardLayout | null>(null);
  const revision = useAppSelector(selectLayoutRevision(dashboardId));
  const revisionRef = useRef(revision);
  const seenRevisionRef = useRef(revision);
  // HEL-1230: the layout the latest effective undo/redo restored; a traversal's store write is
  // recognised by revision change AND equality with it (class 2 in the header contract).
  const applied = useAppSelector(selectAppliedLayout(dashboardId));
  const appliedRef = useRef(applied);
  useEffect(() => {
    revisionRef.current = revision;
    appliedRef.current = applied;
  });
  // The store layout this effect last saw, for placement-extension detection (class 3).
  const prevLayoutRef = useRef<DashboardLayout>(layout);

  useEffect(() => {
    const prevLayout = prevLayoutRef.current;
    prevLayoutRef.current = layout;
    latestLayoutRef.current = layout;
    const isInteractionCommit =
      localCommitRef.current !== null && areDashboardLayoutsEqual(layout, localCommitRef.current);
    const revisionChanged = revisionRef.current !== seenRevisionRef.current;
    seenRevisionRef.current = revisionRef.current;
    const isHistoryTraversal =
      revisionChanged &&
      appliedRef.current !== null &&
      areDashboardLayoutsEqual(layout, appliedRef.current);
    const placement =
      isInteractionCommit || isHistoryTraversal
        ? null
        : detectPlacementExtension(prevLayout, layout);
    if (isInteractionCommit || isHistoryTraversal || placement) {
      // Keep persistedLayoutRef (last server-acknowledged layout); pending is
      // simply whether the displayed layout still differs from it. A placement
      // extends it by the created panel's items first (HEL-1230, D4).
      localCommitRef.current = null;
      if (placement) {
        persistedLayoutRef.current = extendBaseline(persistedLayoutRef.current, placement);
      }
      const pending = !areDashboardLayoutsEqual(layout, persistedLayoutRef.current);
      layoutPendingDispatchedRef.current = pending;
      dispatch(setLayoutPending(pending));
    } else {
      persistedLayoutRef.current = layout;
      // A staged drag that this re-baseline discards (e.g. a server layout landing
      // before the flush) must not leave the pending flag stuck with nothing to save.
      if (layoutPendingDispatchedRef.current) dispatch(setLayoutPending(false));
      // Layout is now in sync with what's persisted, so the pending cycle is
      // over — allow the next real change to re-dispatch setLayoutPending(true).
      layoutPendingDispatchedRef.current = false;
    }
    if (
      inFlightLayoutRef.current !== null &&
      areDashboardLayoutsEqual(inFlightLayoutRef.current, layout)
    ) {
      inFlightLayoutRef.current = null;
    }
  }, [layout, dispatch]);

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

    // HEL-1071: PATCH only the breakpoints that changed, each valid (a changed-and-invalid one is
    // replaced by what the user sees). The baseline then follows what the SERVER stored, not the
    // authored `nextLayout`, so a substituted breakpoint is not mistaken for unchanged next time.
    const { panels: livePanels, panelsLoaded: loaded } = panelsRef.current;
    const patch = buildLayoutPatch(
      nextLayout,
      persistedLayoutRef.current,
      loaded ? resolveDashboardLayout(livePanels, nextLayout) : null,
    );

    inFlightLayoutRef.current = nextLayout;
    void dispatch(updateDashboardLayout({ dashboardId, layout: patch, sentLayout: nextLayout }))
      .unwrap()
      .then((dashboard) => {
        persistedLayoutRef.current = dashboard.layout;
        // HEL-1230 (D5): the store keeps a newer local layout over this response, so recompute pending
        // against the new baseline in BOTH directions — a local edit made while the PATCH was in flight
        // stays pending, and one that already equals the server's layout clears it (never stuck dirty,
        // never blocking the next edit's pending dispatch).
        const pending = !areDashboardLayoutsEqual(latestLayoutRef.current, dashboard.layout);
        layoutPendingDispatchedRef.current = pending;
        dispatch(setLayoutPending(pending));
      })
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

  const commitInteractionLayout = useCallback((next: DashboardLayout) => {
    localCommitRef.current = next;
    return next;
  }, []);

  return { latestLayoutRef, markLayoutChanged, commitInteractionLayout };
}
