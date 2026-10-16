import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

import type { RootState } from "../../../store/store";
import { setSelectedDashboardId } from "../../dashboards/state/dashboardsSlice";
import type { DashboardLayout } from "../../dashboards/types/dashboard";

const MAX_HISTORY_DEPTH = 50;

interface DashboardLayoutHistory {
  past: DashboardLayout[];
  future: DashboardLayout[];
  /** Bumped by every effective undo/redo so a consumer can tell a history
   *  traversal apart from any other store layout change (HEL-1028). */
  revision: number;
  /** The layout the most recent effective undo/redo restored (HEL-1230). `useLayoutSave`
   *  recognises a traversal's store write by revision change AND equality with this, so a no-op
   *  traversal's stale revision cannot capture a later, unrelated store write. */
  applied: DashboardLayout | null;
}

interface LayoutHistoryState {
  byDashboard: Record<string, DashboardLayoutHistory>;
  /** HEL-1576: the dashboard whose layout edit mode is on, or null. Session UI state only: never
   *  persisted, never sent to the server. Edit mode is on for a dashboard iff it equals that
   *  dashboard's id, and selecting any dashboard clears it, so opening or switching dashboards
   *  always starts in view mode. */
  editingLayoutDashboardId: string | null;
  /** HEL-1576: the dashboard whose DESKTOP grid is mounted right now, or null (the phone-style stack
   *  renders below the `sm` boundary, where panels cannot be moved). The meta row offers the layout
   *  edit controls only while it matches the selected dashboard. Session UI state only. */
  desktopGridDashboardId: string | null;
}

const initialState: LayoutHistoryState = {
  byDashboard: {},
  editingLayoutDashboardId: null,
  desktopGridDashboardId: null,
};

function getOrInit(state: LayoutHistoryState, dashboardId: string): DashboardLayoutHistory {
  if (!state.byDashboard[dashboardId]) {
    state.byDashboard[dashboardId] = { past: [], future: [], revision: 0, applied: null };
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
      history.applied = history.past.pop() ?? null;
      history.future.unshift(currentLayout);
      history.revision += 1;
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
      history.applied = history.future.shift() ?? null;
      history.past.push(currentLayout);
      if (history.past.length > MAX_HISTORY_DEPTH) {
        history.past.shift();
      }
      history.revision += 1;
    },
    /**
     * HEL-1576 "Tidy layout": one history entry for a user-requested compaction. Pushes `before` onto
     * the undo stack, clears redo, and marks `after` as the applied layout with a bumped revision, so
     * `useLayoutSave` classifies the store write as a history traversal (class 2: pending, PATCHed by
     * the normal flush) instead of server truth. `pushLayoutSnapshot` alone would not.
     */
    recordLayoutTidy(
      state,
      action: PayloadAction<{
        dashboardId: string;
        before: DashboardLayout;
        after: DashboardLayout;
      }>,
    ) {
      const { dashboardId, before, after } = action.payload;
      const history = getOrInit(state, dashboardId);
      history.past.push(before);
      if (history.past.length > MAX_HISTORY_DEPTH) {
        history.past.shift();
      }
      history.future = [];
      history.applied = after;
      history.revision += 1;
    },
    /** HEL-1576: turn layout edit mode on for `dashboardId`, or off with `null`. */
    setEditingLayoutDashboardId(state, action: PayloadAction<string | null>) {
      state.editingLayoutDashboardId = action.payload;
    },
    /** HEL-1576: `DesktopPanelGrid` reports itself mounted for `dashboardId` (and `null` on unmount). */
    setDesktopGridDashboardId(state, action: PayloadAction<string | null>) {
      state.desktopGridDashboardId = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(setSelectedDashboardId, (state) => {
      state.editingLayoutDashboardId = null;
    });
  },
});

export const {
  pushLayoutSnapshot,
  undoLayout,
  redoLayout,
  recordLayoutTidy,
  setEditingLayoutDashboardId,
  setDesktopGridDashboardId,
} = layoutHistorySlice.actions;
export const layoutHistoryReducer = layoutHistorySlice.reducer;

/** Whether layout edit mode is on for `dashboardId` (HEL-1576). */
export function selectIsEditingLayout(dashboardId: string | null) {
  return (state: RootState): boolean =>
    dashboardId !== null && state.layoutHistory.editingLayoutDashboardId === dashboardId;
}

/** Whether the desktop (movable) grid is what `dashboardId` currently renders (HEL-1576). */
export function selectIsDesktopGridMounted(dashboardId: string | null) {
  return (state: RootState): boolean =>
    dashboardId !== null && state.layoutHistory.desktopGridDashboardId === dashboardId;
}

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

/** Monotonic per-dashboard undo/redo counter (0 when no history exists). */
export function selectLayoutRevision(dashboardId: string | null) {
  return (state: RootState): number => {
    if (!dashboardId) return 0;
    return state.layoutHistory.byDashboard[dashboardId]?.revision ?? 0;
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

/** The layout the latest effective undo/redo restored, or null (HEL-1230). */
export function selectAppliedLayout(dashboardId: string | null) {
  return (state: RootState): DashboardLayout | null => {
    if (!dashboardId) return null;
    return state.layoutHistory.byDashboard[dashboardId]?.applied ?? null;
  };
}
