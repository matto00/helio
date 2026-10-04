import type { ThunkAction, UnknownAction } from "@reduxjs/toolkit";

import type { RootState } from "../../../store/store";
import { setDashboardLayoutLocally } from "../../dashboards/state/dashboardsSlice";
import { redoLayout, selectRedoLayout, selectUndoLayout, undoLayout } from "./layoutHistorySlice";

type LayoutHistoryThunk = ThunkAction<boolean, RootState, unknown, UnknownAction>;

/**
 * HEL-1230: the single undo/redo implementation. The keyboard shortcuts (`useLayoutUndoRedo`) and
 * the CommandBar buttons both dispatch these; nothing else traverses layout history.
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
