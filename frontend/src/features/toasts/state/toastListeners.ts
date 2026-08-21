/**
 * Centralised toast wiring via RTK listenerMiddleware.
 *
 * Two declarative tables — `SUCCESS_TOASTS` and `ERROR_TOASTS` — replace what
 * used to be 33 hand-written `startListening` blocks (HEL-535 D7; the file had
 * crossed CONTRIBUTING.md's ~400-line "propose a split" threshold, and this
 * change adds six more entries on top). Each row names a thunk's `.fulfilled`
 * or `.rejected` action creator plus how to render the toast; two loops below
 * register them.
 *
 * IMPORTANT — this change did not audit which thunks *should* toast; only
 * `toast-notification-consistency` (HEL-535)'s six named swallowed failures
 * were added (D5), plus `deleteMetric`'s success entry (its three sibling
 * delete affordances already had one). That mechanical, whole-app audit is
 * HEL-771. So a thunk's absence from both tables below means "this change
 * left it unchanged" — NOT "deliberately silent". Do not read the tables as
 * an exhaustive silent/loud classification.
 */

import type { UnknownAction } from "@reduxjs/toolkit";

import type { AppStartListening } from "../../../store/listenerMiddleware";
import { pushToast } from "./toastsSlice";

// Dashboards
import {
  createDashboard,
  deleteDashboard,
  duplicateDashboard,
  importDashboard,
  updateDashboardLayout,
} from "../../dashboards/state/dashboardsSlice";

// Panels
import {
  createPanel,
  deletePanel,
  duplicatePanel,
  fetchPanels,
  updatePanelColumnWidths,
  updatePanelsBatch,
} from "../../panels/state/panelsSlice";

// Sources
import {
  createSqlSource,
  createStaticSource,
  deleteSource,
  inferSqlSource,
} from "../../sources/state/sourcesSlice";

// DataTypes
import { deleteDataType } from "../../dataTypes/state/dataTypesSlice";

// Metrics
import { deleteMetric } from "../../metrics/state/metricsSlice";

// Pipelines
import {
  createPipeline,
  deletePipeline,
  savePipelineSchedule,
  submitPipelineRun,
} from "../../pipelines/state/pipelinesSlice";

// Settings (agent memory)
import {
  clearAgentMemoryThunk,
  deleteAgentMemoryEntryThunk,
} from "../../settings/state/settingsSlice";

/** The structural shape `startListening`'s `type` overload needs from a
 *  `createAsyncThunk(...).fulfilled`/`.rejected` action creator — just its
 *  `.type` string, so registration below can key on the literal action type
 *  rather than the creator itself. `(...args: any[])` mirrors RTK's own
 *  `TypedActionCreator` (`addCase`'s bound, `index.d.ts:1045`) — the same
 *  escape hatch RTK uses internally to unify otherwise-unrelated action
 *  creators structurally; it is not exported, so it's reproduced narrowly
 *  here rather than imported. */
interface AsyncThunkResultCreator<A extends { type: string; payload?: unknown }> {
  type: string;
  (...args: any[]): A;
}

interface SuccessToastEntry {
  type: string;
  message: (payload: unknown) => string;
}

interface ErrorToastEntry {
  type: string;
  fallback: string;
}

/** Builds a `SUCCESS_TOASTS` row. `message`'s parameter type is checked here,
 *  at the call site, against the actual `.fulfilled` payload type — the type
 *  information is erased in the stored row (`SuccessToastEntry`) only so the
 *  table below can be a single homogeneous array. */
function success<A extends { type: string; payload?: unknown }>(
  actionCreator: AsyncThunkResultCreator<A>,
  message: (payload: A["payload"]) => string,
): SuccessToastEntry {
  return { type: actionCreator.type, message: message as (payload: unknown) => string };
}

/** Builds an `ERROR_TOASTS` row. Every entry here follows the same shape as
 *  before this rewrite: `action.payload ?? fallback` — `rejectValue` is
 *  `string` for every thunk below. */
function error<A extends { type: string; payload?: string }>(
  actionCreator: AsyncThunkResultCreator<A>,
  fallback: string,
): ErrorToastEntry {
  return { type: actionCreator.type, fallback };
}

// ── Successes (user-initiated, non-trivial) ─────────────────────────────────
const SUCCESS_TOASTS: SuccessToastEntry[] = [
  success(createDashboard.fulfilled, (payload) => `Dashboard "${payload.name}" created.`),
  success(deleteDashboard.fulfilled, () => "Dashboard deleted."),
  success(
    duplicateDashboard.fulfilled,
    (payload) => `Dashboard "${payload.dashboard.name}" duplicated.`,
  ),
  success(
    importDashboard.fulfilled,
    (payload) => `Dashboard "${payload.dashboard.name}" imported.`,
  ),
  success(createPanel.fulfilled, (payload) => `Panel "${payload.title}" created.`),
  success(deletePanel.fulfilled, () => "Panel deleted."),
  success(duplicatePanel.fulfilled, () => "Panel duplicated."),
  // HEL-535 D6 — renamed from "connected." to "created." so this listener's
  // wording matches `createStaticSource` and `AddSourceModal.finishCreate`
  // exactly (previously the SQL create path was the only one of the add-
  // source modal's seven paths to read differently).
  success(createSqlSource.fulfilled, (payload) => `Data source "${payload.name}" created.`),
  success(createStaticSource.fulfilled, (payload) => `Data source "${payload.name}" created.`),
  success(deleteSource.fulfilled, () => "Data source deleted."),
  success(deleteDataType.fulfilled, () => "Data type deleted."),
  success(createPipeline.fulfilled, (payload) => `Pipeline "${payload.name}" created.`),
  success(deletePipeline.fulfilled, () => "Pipeline deleted."),
  success(deleteAgentMemoryEntryThunk.fulfilled, () => "Memory entry deleted."),
  success(clearAgentMemoryThunk.fulfilled, () => "Agent memory cleared."),
  // HEL-535 D5 (include-metrics) — deleteMetric's three sibling delete
  // affordances (dashboards/panels/sources et al.) already toast on success;
  // this one silently didn't.
  success(deleteMetric.fulfilled, () => "Metric deleted."),
];

// ── Errors (meaningful failures) ────────────────────────────────────────────
const ERROR_TOASTS: ErrorToastEntry[] = [
  error(createDashboard.rejected, "Failed to create dashboard."),
  error(deleteDashboard.rejected, "Failed to delete dashboard."),
  error(duplicateDashboard.rejected, "Failed to duplicate dashboard."),
  error(importDashboard.rejected, "Failed to import dashboard."),
  error(createPanel.rejected, "Failed to create panel."),
  error(deletePanel.rejected, "Failed to delete panel."),
  error(duplicatePanel.rejected, "Failed to duplicate panel."),
  error(fetchPanels.rejected, "Failed to load panels."),
  error(createSqlSource.rejected, "Failed to create SQL source."),
  error(createStaticSource.rejected, "Failed to create static source."),
  error(deleteSource.rejected, "Failed to delete source."),
  error(inferSqlSource.rejected, "Failed to connect to database."),
  error(deleteDataType.rejected, "Failed to delete data type."),
  error(createPipeline.rejected, "Failed to create pipeline."),
  error(deletePipeline.rejected, "Failed to delete pipeline."),
  error(submitPipelineRun.rejected, "Failed to start pipeline run."),
  error(deleteAgentMemoryEntryThunk.rejected, "Failed to delete memory entry."),
  error(clearAgentMemoryThunk.rejected, "Failed to clear agent memory."),
  // HEL-535 D5 — closes three of the six previously-swallowed auto-save
  // writes: no toast, no inline error, no console signal before this change.
  // Fallback wording names what the user did, not the wire call:
  error(updateDashboardLayout.rejected, "Failed to save dashboard layout."),
  error(updatePanelsBatch.rejected, "Failed to save panel changes."),
  error(updatePanelColumnWidths.rejected, "Failed to resize columns."),
  // HEL-535 D5 — closes the header-toggle path (PipelineDetailHeader's
  // <Toggle> previously just silently refused to move on failure). Known,
  // tracked duplicate on the schedule dialog's OWN save path
  // (PipelineScheduleDialog.tsx already shows an inline error there) —
  // accepted per D5: while any Modal is open the toast viewport paints below
  // the native <dialog> top layer (Modal.css's --app-overlay), so the toast
  // is effectively invisible and inert there; the header toggle is this
  // entry's only real beneficiary. Resolving the double-report generally is
  // HEL-771's job, not this change's.
  error(savePipelineSchedule.rejected, "Failed to save pipeline schedule."),
  // HEL-535 D5 (include-metrics) — deleteMetric's rejection was dropped at
  // all three dispatch sites (none called `.unwrap()`).
  error(deleteMetric.rejected, "Failed to delete metric."),
];

export function addToastListeners(startListening: AppStartListening) {
  for (const { type, message } of SUCCESS_TOASTS) {
    startListening({
      type,
      effect: (action, { dispatch }) => {
        dispatch(
          pushToast({
            variant: "success",
            message: message((action as UnknownAction & { payload: unknown }).payload),
          }),
        );
      },
    });
  }

  for (const { type, fallback } of ERROR_TOASTS) {
    startListening({
      type,
      effect: (action, { dispatch }) => {
        const payload = (action as UnknownAction & { payload?: string }).payload;
        dispatch(pushToast({ variant: "error", message: payload ?? fallback }));
      },
    });
  }
}
