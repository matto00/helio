import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

import type { RootState } from "../../store/store";
import type { DashboardLayout } from "../../types/models";

const MAX_HISTORY_DEPTH = 50;

interface DashboardLayoutHistory {
  past: DashboardLayout[];
  future: DashboardLayout[];
}

interface LayoutHistoryState {
  byDashboard: Record<string, DashboardLayoutHistory>;
}

const initialState: LayoutHistoryState = {
  byDashboard: {},
};

function getOrInit(state: LayoutHistoryState, dashboardId: string): DashboardLayoutHistory {
  if (!state.byDashboard[dashboardId]) {
    state.byDashboard[dashboardId] = { past: [], future: [] };
  }
  return state.byDashboard[dashboardId];
}

const layoutHistorySlice = createSlice({
  name: "layoutHistory",
  initialState,
  reducers: {
    /**
     * Call after a drag/resize completes. Pushes the *previous* layout (before
     * the interaction) onto the undo stack and clears the redo stack.
     */
    pushLayoutSnapshot(
      state,
      action: PayloadAction<{ dashboardId: string; layout: DashboardLayout }>,
    ) {
      const { dashboardId, layout } = action.payload;
      const history = getOrInit(state, dashboardId);
      history.past.push(layout);
      if (history.past.length > MAX_HISTORY_DEPTH) {
        history.past.shift();
      }
      history.future = [];
    },
    /**
     * Pops the undo stack and pushes `currentLayout` onto the redo stack.
     * The caller must read `selectUndoLayout` *before* dispatching to get the
     * target layout to apply via `setDashboardLayoutLocally`.
     */
    undoLayout(
      state,
      action: PayloadAction<{ dashboardId: string; currentLayout: DashboardLayout }>,
    ) {
      const { dashboardId, currentLayout } = action.payload;
      const history = getOrInit(state, dashboardId);
      if (history.past.length === 0) return;
      history.past.pop();
      history.future.unshift(currentLayout);
    },
    /**
     * Pops the redo stack and pushes `currentLayout` onto the undo stack.
     * The caller must read `selectRedoLayout` *before* dispatching to get the
     * target layout to apply via `setDashboardLayoutLocally`.
     */
    redoLayout(
      state,
      action: PayloadAction<{ dashboardId: string; currentLayout: DashboardLayout }>,
    ) {
      const { dashboardId, currentLayout } = action.payload;
      const history = getOrInit(state, dashboardId);
      if (history.future.length === 0) return;
      history.future.shift();
      history.past.push(currentLayout);
      if (history.past.length > MAX_HISTORY_DEPTH) {
        history.past.shift();
      }
    },
  },
});

export const { pushLayoutSnapshot, undoLayout, redoLayout } = layoutHistorySlice.actions;
export const layoutHistoryReducer = layoutHistorySlice.reducer;

// --- Selectors ---

export function selectCanUndo(dashboardId: string | null) {
  return (state: RootState): boolean => {
    if (!dashboardId) return false;
    return (state.layoutHistory.byDashboard[dashboardId]?.past.length ?? 0) > 0;
  };
}

export function selectCanRedo(dashboardId: string | null) {
  return (state: RootState): boolean => {
    if (!dashboardId) return false;
    return (state.layoutHistory.byDashboard[dashboardId]?.future.length ?? 0) > 0;
  };
}

/** The layout that would be restored by an undo — top of the past stack. */
export function selectUndoLayout(dashboardId: string | null) {
  return (state: RootState): DashboardLayout | undefined => {
    if (!dashboardId) return undefined;
    const history = state.layoutHistory.byDashboard[dashboardId];
    if (!history || history.past.length === 0) return undefined;
    return history.past[history.past.length - 1];
  };
}

/** The layout that would be restored by a redo — top of the future stack. */
export function selectRedoLayout(dashboardId: string | null) {
  return (state: RootState): DashboardLayout | undefined => {
    if (!dashboardId) return undefined;
    const history = state.layoutHistory.byDashboard[dashboardId];
    if (!history || history.future.length === 0) return undefined;
    return history.future[0];
  };
}
