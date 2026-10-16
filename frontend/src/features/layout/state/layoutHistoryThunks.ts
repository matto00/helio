import type { ThunkAction, UnknownAction } from "@reduxjs/toolkit";

import type { RootState } from "../../../store/store";
import type { DashboardLayout } from "../../dashboards/types/dashboard";
import { setDashboardLayoutLocally } from "../../dashboards/state/dashboardsSlice";
import { tidyLayout } from "../../dashboards/state/tidyLayout";
import {
  recordLayoutTidy,
  redoLayout,
  selectRedoLayout,
  selectUndoLayout,
  undoLayout,
} from "./layoutHistorySlice";

type LayoutHistoryThunk = ThunkAction<boolean, RootState, unknown, UnknownAction>;

/**
 * HEL-1230: the single undo/redo implementation. The keyboard shortcuts (`useLayoutUndoRedo`) and
 * the meta row's edit-mode buttons both dispatch these; nothing else traverses layout history.
 *
 * An undo/redo is a LOCAL layout edit, persisted by the same deferred flush as a drag/resize
 * (auto-save tick, Save now, grid unmount) — never by an immediate PATCH. `useLayoutSave`
 * recognises the store write via `selectAppliedLayout` (see its header).
 *
 * Reads the target and current layout from live state, so callers hold no render-time closures.
 * Returns `true` when a traversal was applied, `false` (dispatching nothing) when there is no
 * target or no current layout.
 */
function applyTraversal(
  dashboardId: string,
  selectTarget: typeof selectUndoLayout,
  traverse: typeof undoLayout | typeof redoLayout,
): LayoutHistoryThunk {
  return (dispatch, getState) => {
    const state = getState();
    const target = selectTarget(dashboardId)(state);
    const currentLayout = state.dashboards.items.find((d) => d.id === dashboardId)?.layout;
    if (!target || !currentLayout) return false;
    dispatch(traverse({ dashboardId, currentLayout }));
    dispatch(setDashboardLayoutLocally({ dashboardId, layout: target }));
    return true;
  };
}

export function applyLayoutUndo(dashboardId: string): LayoutHistoryThunk {
  return applyTraversal(dashboardId, selectUndoLayout, undoLayout);
}

export function applyLayoutRedo(dashboardId: string): LayoutHistoryThunk {
  return applyTraversal(dashboardId, selectRedoLayout, redoLayout);
}

/** The dashboard's tidied layout (HEL-1576), or `undefined` when there is nothing to tidy (or the
 *  dashboard or its panels are not loaded). Shared by `applyLayoutTidy` and the "Tidy layout"
 *  button's enabled state, so the button is disabled exactly when the click would do nothing. */
function pendingTidy(
  state: RootState,
  dashboardId: string,
): { before: DashboardLayout; after: DashboardLayout } | undefined {
  const before = state.dashboards.items.find((d) => d.id === dashboardId)?.layout;
  if (!before || state.panels.loadedDashboardId !== dashboardId) return undefined;
  const after = tidyLayout(before, state.panels.items);
  return after === before ? undefined : { before, after };
}

export function selectCanTidyLayout(dashboardId: string | null) {
  return (state: RootState): boolean =>
    dashboardId !== null && pendingTidy(state, dashboardId) !== undefined;
}

/**
 * HEL-1576 "Tidy layout": compacts the dashboard's authored layout upward as ONE history entry, so a
 * single undo restores every breakpoint. Like undo/redo it is a LOCAL edit persisted by the normal
 * deferred flush (`recordLayoutTidy` makes `useLayoutSave` classify it as pending); nothing here
 * PATCHes, and nothing dispatches this except the user's click. Returns `true` when it changed the
 * layout.
 */
export function applyLayoutTidy(dashboardId: string): LayoutHistoryThunk {
  return (dispatch, getState) => {
    const tidy = pendingTidy(getState(), dashboardId);
    if (!tidy) return false;
    dispatch(recordLayoutTidy({ dashboardId, ...tidy }));
    dispatch(setDashboardLayoutLocally({ dashboardId, layout: tidy.after }));
    return true;
  };
}
