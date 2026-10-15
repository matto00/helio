import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

import { clearAuth } from "../../auth/state/authSlice";
import { MAX_TABS, parseInstant, type DashboardChange, type DashboardTab } from "./tabTypes";

// HEL-1575 D1/D3: the open-tab set. `dashboards.selectedDashboardId` stays the single source of which
// dashboard is SHOWN; this slice mirrors it (kept in step by `dashboardTabsListeners.ts`) and owns the
// ordered set, the active id and the change signals. Inert (every selection-driven rule) until `hydrated`.

export interface DashboardTabsState {
  tabs: DashboardTab[];
  activeId: string | null;
  /** True once `hydrateTabs` has chosen the target tab. `App.tsx` waits for it before loading panels. */
  hydrated: boolean;
  /** D6 change signals per dashboard id; absent until fetched. */
  changeSignals: Record<string, DashboardChange>;
  /** D7: `serverNow - Date.now()`, measured when the latest signals response arrived. */
  serverOffsetMs: number;
}

export const initialDashboardTabsState: DashboardTabsState = {
  tabs: [],
  activeId: null,
  hydrated: false,
  changeSignals: {},
  serverOffsetMs: 0,
};

/** The tab that becomes active when `index` is removed from `tabs`: the right neighbour, else the left,
 *  else none (D1 `closeTab`). */
function neighbourOf(tabs: DashboardTab[], index: number): string | null {
  return tabs[index + 1]?.id ?? tabs[index - 1]?.id ?? null;
}

/** D3: the inactive tab with the oldest `lastViewedAt` (null counts as oldest, ties go to the leftmost). */
function lruInactiveIndex(tabs: DashboardTab[], activeId: string | null): number {
  let best = -1;
  let bestAt = Infinity;
  tabs.forEach((tab, index) => {
    if (tab.id === activeId) return;
    const at = parseInstant(tab.lastViewedAt) ?? -Infinity;
    if (best === -1 || at < bestAt) {
      best = index;
      bestAt = at;
    }
  });
  return best;
}

function newTab(id: string): DashboardTab {
  return { id, lastViewedAt: null, ownWriteAt: null };
}

/** Inserts `id` after the active tab (at the end with none), evicting the LRU inactive tab at the cap. */
function insertAfterActive(state: DashboardTabsState, id: string): void {
  if (state.tabs.length >= MAX_TABS) {
    const victim = lruInactiveIndex(state.tabs, state.activeId);
    if (victim !== -1) state.tabs.splice(victim, 1);
  }
  const activeIndex = state.tabs.findIndex((tab) => tab.id === state.activeId);
  state.tabs.splice(activeIndex === -1 ? state.tabs.length : activeIndex + 1, 0, newTab(id));
}

/** Removes `id`; when it was the active tab the neighbour rule picks the next active id. */
function removeTab(state: DashboardTabsState, id: string): void {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return;
  const wasActive = state.activeId === id;
  const next = wasActive ? neighbourOf(state.tabs, index) : state.activeId;
  state.tabs.splice(index, 1);
  state.activeId = next;
}

const dashboardTabsSlice = createSlice({
  name: "dashboardTabs",
  initialState: initialDashboardTabsState,
  reducers: {
    /** `persist: false` for a pure restore of the saved set (nothing to write back). */
    tabsHydrated(
      state,
      action: PayloadAction<{ tabs: DashboardTab[]; activeId: string | null; persist: boolean }>,
    ) {
      state.tabs = action.payload.tabs;
      state.activeId = action.payload.activeId;
      state.hydrated = true;
    },
    /** Activate an open tab (a no-op for an unknown id). */
    activateTab(state, action: PayloadAction<string>) {
      if (state.tabs.some((tab) => tab.id === action.payload)) state.activeId = action.payload;
    },
    /** Open `id` after the active tab WITHOUT changing the selection (a no-op if already open). */
    openTabInBackground(state, action: PayloadAction<string>) {
      if (state.tabs.some((tab) => tab.id === action.payload)) return;
      insertAfterActive(state, action.payload);
    },
    /** Open `id` after the active tab (or activate it if open) and make it active. */
    openTabActivate(state, action: PayloadAction<string>) {
      if (!state.tabs.some((tab) => tab.id === action.payload)) {
        insertAfterActive(state, action.payload);
      }
      state.activeId = action.payload;
    },
    /** D1 "otherwise": the selection moved to a dashboard that is not open, so it replaces the active tab
     *  in place (the only tab when there is none). */
    replaceActiveTab(state, action: PayloadAction<string>) {
      const index = state.tabs.findIndex((tab) => tab.id === state.activeId);
      if (index === -1) {
        insertAfterActive(state, action.payload);
      } else {
        state.tabs[index] = newTab(action.payload);
      }
      state.activeId = action.payload;
    },
    /** The selection became null: the tabs stay, none is active. */
    clearActiveTab(state) {
      state.activeId = null;
    },
    closeTab(state, action: PayloadAction<string>) {
      removeTab(state, action.payload);
    },
    moveTab(state, action: PayloadAction<{ id: string; toIndex: number }>) {
      const from = state.tabs.findIndex((tab) => tab.id === action.payload.id);
      if (from === -1) return;
      const to = Math.max(0, Math.min(state.tabs.length - 1, action.payload.toIndex));
      const [tab] = state.tabs.splice(from, 1);
      state.tabs.splice(to, 0, tab);
    },
    /** Drops tabs whose dashboard no longer exists (the active one follows the neighbour rule). */
    tabsPruned(state, action: PayloadAction<string[]>) {
      for (const id of action.payload) removeTab(state, id);
    },
    tabViewed(state, action: PayloadAction<{ id: string; at: string }>) {
      const tab = state.tabs.find((t) => t.id === action.payload.id);
      if (tab) tab.lastViewedAt = action.payload.at;
    },
    /** D4: the server-time instant the client received the success of its own content write. Only moves
     *  forward. */
    tabOwnWrite(state, action: PayloadAction<{ id: string; at: string }>) {
      const tab = state.tabs.find((t) => t.id === action.payload.id);
      if (!tab) return;
      const current = parseInstant(tab.ownWriteAt);
      const next = parseInstant(action.payload.at);
      if (next !== null && (current === null || next > current)) tab.ownWriteAt = action.payload.at;
    },
    changeSignalsReceived(
      state,
      action: PayloadAction<{ items: DashboardChange[]; serverOffsetMs: number }>,
    ) {
      for (const item of action.payload.items) state.changeSignals[item.dashboardId] = item;
      state.serverOffsetMs = action.payload.serverOffsetMs;
    },
  },
  extraReducers: (builder) => {
    // Logout and the 401 sign-out: the next user must start from nothing.
    builder.addCase(clearAuth, () => initialDashboardTabsState);
  },
});

export const {
  tabsHydrated,
  activateTab,
  openTabInBackground,
  openTabActivate,
  replaceActiveTab,
  clearActiveTab,
  closeTab,
  moveTab,
  tabsPruned,
  tabViewed,
  tabOwnWrite,
  changeSignalsReceived,
} = dashboardTabsSlice.actions;
export const dashboardTabsReducer = dashboardTabsSlice.reducer;
