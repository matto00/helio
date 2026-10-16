// HEL-1575 D4/D5: the listener-middleware wiring of the warm cache -- fetch bookkeeping, the own-write
// table (task 4.0), warm drops on Output/pipeline/source delete, and `clearWarmState` on `clearAuth`.

import { isAnyOf, type Action } from "@reduxjs/toolkit";

import type { AppStartListening } from "../../../../store/listenerMiddleware";
import type { RootState } from "../../../../store/store";
import { clearAuth } from "../../../auth/state/authSlice";
import { applyPatchSet, undoPatchSet } from "../../../patchSets/state/patchSetsSlice";
import {
  createPanel,
  deletePanel,
  duplicatePanel,
  fetchPanels,
  markDashboardPanelsStale,
  updatePanelAppearance,
  updatePanelDivider,
  updatePanelForm,
  updatePanelImage,
  updatePanelMarkdownContent,
  updatePanelOutputControls,
  updatePanelsBatch,
  updatePanelTextContent,
  updatePanelTitle,
} from "../../../panels/state/panelsSlice";
import { swapPanelOutput } from "../../../panels/state/panelThunks";
import { resetOutputFreshness } from "../../../panels/state/outputFreshness";
import { deleteOutput } from "../../../pipelines/state/outputsSlice";
import { deletePipeline } from "../../../pipelines/state/pipelinesSlice";
import { deleteSource } from "../../../sources/state/sourcesSlice";
import type { PatchSet } from "../../../patchSets/types/patchSet";
import {
  applyProposal,
  duplicateDashboard,
  importDashboard,
  renameDashboard,
  updateDashboardAppearance,
  updateDashboardLayout,
} from "../../state/dashboardsSlice";
import {
  clearWarmState,
  discardFetchStart,
  dropWarmForOutputs,
  noteOwnDashboardWrite,
  recordFetchResult,
  recordFetchStart,
} from "./warmCache";
import { captureTab } from "./warmCapture";

/** One client content-write path: the actions that signal its success, and the dashboard ids it wrote. */
export interface OwnWriteSource {
  name: string;
  matches: (action: Action) => boolean;
  dashboardIds: (action: never) => string[];
}

const PANEL_PAYLOAD_UPDATES = [
  updatePanelTitle,
  updatePanelAppearance,
  updatePanelTextContent,
  updatePanelMarkdownContent,
  updatePanelImage,
  updatePanelDivider,
  updatePanelForm,
  updatePanelOutputControls,
  createPanel,
  duplicatePanel,
  swapPanelOutput,
] as const;

function dashboardIdsOfPatchSet(
  patchSet: PatchSet,
  edits: Array<{ index: number; resultingState?: Record<string, unknown> | null }>,
): string[] {
  const ids: string[] = [];
  for (const outcome of edits) {
    if (patchSet.edits[outcome.index]?.target.kind !== "dashboard") continue;
    const id = outcome.resultingState?.id;
    if (typeof id === "string") ids.push(id);
  }
  return ids;
}

/** The enumerated table (design D4; grep over `services/*` calls that hit `/api/dashboards/:id` (PATCH,
 *  POST) and `/api/panels*`). Every entry's success calls `noteOwnDashboardWrite` for the dashboard(s) it
 *  wrote. A batch panel update attributes each response panel's OWN `dashboardId`, never the selection.
 *  Deliberately absent: the one-time layout repair (it is not an edit: HEL-1233), dataset row writes and
 *  form submits (data, not content), and folder moves. */
export const OWN_WRITE_SOURCES: OwnWriteSource[] = [
  ...PANEL_PAYLOAD_UPDATES.map(
    (thunk): OwnWriteSource => ({
      name: thunk.typePrefix,
      matches: thunk.fulfilled.match as (a: Action) => boolean,
      dashboardIds: (action: { payload: { dashboardId: string } }) => [action.payload.dashboardId],
    }),
  ),
  {
    name: deletePanel.typePrefix,
    matches: deletePanel.fulfilled.match as (a: Action) => boolean,
    dashboardIds: (action: { meta: { arg: { dashboardId: string } } }) => [
      action.meta.arg.dashboardId,
    ],
  },
  {
    name: updatePanelsBatch.typePrefix,
    matches: updatePanelsBatch.fulfilled.match as (a: Action) => boolean,
    dashboardIds: (action: { payload: { panels: Array<{ dashboardId: string }> } }) => [
      ...new Set(action.payload.panels.map((p) => p.dashboardId)),
    ],
  },
  {
    name: "panels/markDashboardPanelsStale (patch-set panel edits)",
    matches: markDashboardPanelsStale.match as (a: Action) => boolean,
    dashboardIds: (action: { payload: string }) => [action.payload],
  },
  ...[renameDashboard, updateDashboardAppearance, updateDashboardLayout].map(
    (thunk): OwnWriteSource => ({
      name: thunk.typePrefix,
      matches: thunk.fulfilled.match as (a: Action) => boolean,
      dashboardIds: (action: { payload: { id: string } }) => [action.payload.id],
    }),
  ),
  ...[duplicateDashboard, importDashboard, applyProposal].map(
    (thunk): OwnWriteSource => ({
      name: thunk.typePrefix,
      matches: thunk.fulfilled.match as (a: Action) => boolean,
      dashboardIds: (action: { payload: { dashboard: { id: string } } }) => [
        action.payload.dashboard.id,
      ],
    }),
  ),
  {
    name: applyPatchSet.typePrefix,
    matches: applyPatchSet.fulfilled.match as (a: Action) => boolean,
    dashboardIds: (action: { meta: { arg: PatchSet }; payload: { edits: never[] } }) =>
      dashboardIdsOfPatchSet(action.meta.arg, action.payload.edits),
  },
  {
    name: undoPatchSet.typePrefix,
    matches: undoPatchSet.fulfilled.match as (a: Action) => boolean,
    dashboardIds: (action: {
      meta: { arg: { patchSet: PatchSet } };
      payload: { edits: never[] };
    }) => dashboardIdsOfPatchSet(action.meta.arg.patchSet, action.payload.edits),
  },
];

export function addWarmListeners(startListening: AppStartListening): void {
  // Bookkeeping for `contentCapturedAt`: the server-time START of the request that produced a list.
  startListening({
    actionCreator: fetchPanels.pending,
    effect: (action) => recordFetchStart(action.meta.requestId),
  });
  startListening({
    actionCreator: fetchPanels.fulfilled,
    effect: (action) => recordFetchResult(action.meta.arg, action.meta.requestId, action.payload),
  });
  startListening({
    actionCreator: fetchPanels.rejected,
    effect: (action) => discardFetchStart(action.meta.requestId),
  });

  // Task 4.0: every client content-write success records an own write.
  startListening({
    predicate: (action) => OWN_WRITE_SOURCES.some((source) => source.matches(action)),
    effect: (action, listenerApi) => {
      const state = listenerApi.getState() as RootState;
      const userId = state.auth.currentUser?.id ?? null;
      for (const source of OWN_WRITE_SOURCES) {
        if (!source.matches(action)) continue;
        // `matches` has just narrowed `action` to this source's own action shape, but the table mixes shapes, so
        // `dashboardIds` is typed `never`-in; `warmListeners.test.ts`'s own-write table exercises every shape.
        for (const id of source.dashboardIds(action as never)) {
          // "On screen": the active tab, or the loaded list. `markDashboardPanelsStale` (itself an own-write
          // source) clears `loadedDashboardId` until its refetch lands, so the loaded list alone misses it.
          const listLoaded =
            state.dashboardTabs.activeId === id || state.panels.loadedDashboardId === id;
          noteOwnDashboardWrite(listenerApi.dispatch, userId, id, listLoaded);
          // The loaded list already reflects this write (its reducer, or the refetch inside the thunk, ran
          // before this effect), so store it again straight away, claiming the write it now includes.
          if (listLoaded)
            captureTab(listenerApi.getState as () => RootState, id, { retain: false });
        }
      }
    },
  });

  // D6 known gap: a client-side delete that cascades to panels drops the affected warm copies.
  startListening({
    actionCreator: deleteOutput.fulfilled,
    effect: (action, listenerApi) => {
      const userId = (listenerApi.getState() as RootState).auth.currentUser?.id ?? null;
      void dropWarmForOutputs(userId, [action.payload.outputId]);
    },
  });
  startListening({
    predicate: isAnyOf(deleteSource.fulfilled, deletePipeline.fulfilled),
    effect: (_action, listenerApi) => {
      const userId = (listenerApi.getState() as RootState).auth.currentUser?.id ?? null;
      void dropWarmForOutputs(userId, "all");
    },
  });

  // D5 clearing: logout AND the 401 sign-out both dispatch `clearAuth`.
  startListening({
    actionCreator: clearAuth,
    effect: () => {
      resetOutputFreshness();
      void clearWarmState();
    },
  });
}
