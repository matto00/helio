import { configureStore, type UnknownAction } from "@reduxjs/toolkit";

import { addToastListeners } from "./toastListeners";
import { toastsReducer, dismissToast } from "./toastsSlice";
import { listenerMiddleware, startAppListening } from "../../../store/listenerMiddleware";

import {
  createDashboard,
  deleteDashboard,
  duplicateDashboard,
  importDashboard,
  updateDashboardLayout,
} from "../../dashboards/state/dashboardsSlice";
import {
  createPanel,
  deletePanel,
  duplicatePanel,
  fetchPanels,
  updatePanelColumnWidths,
  updatePanelsBatch,
} from "../../panels/state/panelsSlice";
import {
  createSqlSource,
  createStaticSource,
  deleteSource,
  inferSqlSource,
} from "../../sources/state/sourcesSlice";
import { deleteDataType } from "../../dataTypes/state/dataTypesSlice";
import { deleteMetric } from "../../metrics/state/metricsSlice";
import {
  createPipeline,
  deletePipeline,
  savePipelineSchedule,
  submitPipelineRun,
} from "../../pipelines/state/pipelinesSlice";
import {
  clearAgentMemoryThunk,
  deleteAgentMemoryEntryThunk,
} from "../../settings/state/settingsSlice";

// Registered exactly once against the module-level `listenerMiddleware`
// singleton (HEL-535) — calling `addToastListeners` again per-test would
// double-register every entry, so each dispatched action would fire its
// effect N times instead of once.
addToastListeners(startAppListening);

function makeStore() {
  return configureStore({
    reducer: { toasts: toastsReducer },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().prepend(listenerMiddleware.middleware),
  });
}

const store = makeStore();

/** Dispatches a bare `{ type, payload }` action — the listener effects below
 *  read only `.type` and `.payload`, so this exercises exactly what
 *  `toastListeners.ts` is responsible for without needing a realistic
 *  `requestId`/`meta`/full domain fixture per thunk. Asserts exactly one
 *  toast is added, then clears state so the next assertion starts clean
 *  (state is shared across this file to register listeners exactly once). */
function expectToast(
  action: UnknownAction,
  variant: "success" | "error",
  message: string | RegExp,
) {
  const before = store.getState().toasts.items.length;
  store.dispatch(action);
  const items = store.getState().toasts.items;
  expect(items).toHaveLength(before + 1);
  const toast = items[items.length - 1];
  expect(toast.variant).toBe(variant);
  if (typeof message === "string") {
    expect(toast.message).toBe(message);
  } else {
    expect(toast.message).toMatch(message);
  }
  for (const t of store.getState().toasts.items) {
    store.dispatch(dismissToast(t.id));
  }
  expect(store.getState().toasts.items).toHaveLength(0);
}

describe("toastListeners — regression guard (every pre-existing entry still fires, HEL-535 D7/3.7)", () => {
  it("dashboards: create/delete/duplicate/import success + error", () => {
    expectToast(
      { type: createDashboard.fulfilled.type, payload: { name: "Q3 Sales" } },
      "success",
      'Dashboard "Q3 Sales" created.',
    );
    expectToast(
      { type: createDashboard.rejected.type, payload: undefined },
      "error",
      "Failed to create dashboard.",
    );
    expectToast(
      { type: deleteDashboard.fulfilled.type, payload: "d1" },
      "success",
      "Dashboard deleted.",
    );
    expectToast(
      { type: deleteDashboard.rejected.type, payload: undefined },
      "error",
      "Failed to delete dashboard.",
    );
    expectToast(
      {
        type: duplicateDashboard.fulfilled.type,
        payload: { dashboard: { name: "Q3 Sales copy" } },
      },
      "success",
      'Dashboard "Q3 Sales copy" duplicated.',
    );
    expectToast(
      { type: duplicateDashboard.rejected.type, payload: undefined },
      "error",
      "Failed to duplicate dashboard.",
    );
    expectToast(
      { type: importDashboard.fulfilled.type, payload: { dashboard: { name: "Imported" } } },
      "success",
      'Dashboard "Imported" imported.',
    );
    expectToast(
      { type: importDashboard.rejected.type, payload: undefined },
      "error",
      "Failed to import dashboard.",
    );
  });

  it("panels: create/delete/duplicate success + error, fetchPanels error", () => {
    expectToast(
      { type: createPanel.fulfilled.type, payload: { title: "Revenue" } },
      "success",
      'Panel "Revenue" created.',
    );
    expectToast(
      { type: createPanel.rejected.type, payload: undefined },
      "error",
      "Failed to create panel.",
    );
    expectToast({ type: deletePanel.fulfilled.type, payload: "p1" }, "success", "Panel deleted.");
    expectToast(
      { type: deletePanel.rejected.type, payload: undefined },
      "error",
      "Failed to delete panel.",
    );
    expectToast(
      { type: duplicatePanel.fulfilled.type, payload: { title: "Revenue copy" } },
      "success",
      "Panel duplicated.",
    );
    expectToast(
      { type: duplicatePanel.rejected.type, payload: undefined },
      "error",
      "Failed to duplicate panel.",
    );
    expectToast(
      { type: fetchPanels.rejected.type, payload: undefined },
      "error",
      "Failed to load panels.",
    );
  });

  it("sources: SQL/static create success + error, delete, inferSqlSource error", () => {
    expectToast(
      { type: createSqlSource.fulfilled.type, payload: { name: "Warehouse" } },
      "success",
      'Data source "Warehouse" created.',
    );
    expectToast(
      { type: createSqlSource.rejected.type, payload: undefined },
      "error",
      "Failed to create SQL source.",
    );
    expectToast(
      { type: createStaticSource.fulfilled.type, payload: { name: "Reference" } },
      "success",
      'Data source "Reference" created.',
    );
    expectToast(
      { type: createStaticSource.rejected.type, payload: undefined },
      "error",
      "Failed to create static source.",
    );
    expectToast(
      { type: deleteSource.fulfilled.type, payload: "s1" },
      "success",
      "Data source deleted.",
    );
    expectToast(
      { type: deleteSource.rejected.type, payload: undefined },
      "error",
      "Failed to delete source.",
    );
    expectToast(
      { type: inferSqlSource.rejected.type, payload: undefined },
      "error",
      "Failed to connect to database.",
    );
  });

  it("dataTypes: delete success + error", () => {
    expectToast(
      { type: deleteDataType.fulfilled.type, payload: "dt1" },
      "success",
      "Data type deleted.",
    );
    expectToast(
      { type: deleteDataType.rejected.type, payload: undefined },
      "error",
      "Failed to delete data type.",
    );
  });

  it("pipelines: create/delete success + error, submitPipelineRun error", () => {
    expectToast(
      { type: createPipeline.fulfilled.type, payload: { name: "ETL" } },
      "success",
      'Pipeline "ETL" created.',
    );
    expectToast(
      { type: createPipeline.rejected.type, payload: undefined },
      "error",
      "Failed to create pipeline.",
    );
    expectToast(
      { type: deletePipeline.fulfilled.type, payload: "pl1" },
      "success",
      "Pipeline deleted.",
    );
    expectToast(
      { type: deletePipeline.rejected.type, payload: undefined },
      "error",
      "Failed to delete pipeline.",
    );
    expectToast(
      { type: submitPipelineRun.rejected.type, payload: undefined },
      "error",
      "Failed to start pipeline run.",
    );
  });

  it("settings (agent memory): delete/clear success + error", () => {
    expectToast(
      { type: deleteAgentMemoryEntryThunk.fulfilled.type, payload: "m1" },
      "success",
      "Memory entry deleted.",
    );
    expectToast(
      { type: deleteAgentMemoryEntryThunk.rejected.type, payload: undefined },
      "error",
      "Failed to delete memory entry.",
    );
    expectToast(
      { type: clearAgentMemoryThunk.fulfilled.type, payload: undefined },
      "success",
      "Agent memory cleared.",
    );
    expectToast(
      { type: clearAgentMemoryThunk.rejected.type, payload: undefined },
      "error",
      "Failed to clear agent memory.",
    );
  });

  it("an explicit rejected payload wins over the table's fallback (unchanged behaviour)", () => {
    expectToast(
      {
        type: deleteDashboard.rejected.type,
        payload: "Someone else already deleted this dashboard.",
      },
      "error",
      "Someone else already deleted this dashboard.",
    );
  });
});

describe("toastListeners — HEL-535 D5: previously-swallowed failures now report (5.9)", () => {
  // evaluation-1.md CR3 — all three of these thunks' `catch` blocks always
  // call `rejectWithValue("<literal>")` (panelThunks.ts / dashboardsSlice.ts),
  // so `.rejected.payload` is NEVER `undefined` in production; the table's
  // `payload ?? fallback` fallback branch is dead for all three. Dispatching
  // `payload: undefined` here (as this file previously did) tests a state
  // these thunks cannot produce and would not have caught CR3's bug (two of
  // the three fallback strings didn't match the thunk's own literal, so the
  // toast the user actually saw was the wire-phrased string, not the
  // user-phrased one this table declares). Dispatching the thunk's real
  // `rejectWithValue` string as `payload` exercises the reachable path and
  // pins the two in sync.
  it("updateDashboardLayout rejection emits exactly one error toast", () => {
    expectToast(
      { type: updateDashboardLayout.rejected.type, payload: "Failed to save dashboard layout." },
      "error",
      "Failed to save dashboard layout.",
    );
  });

  it("updatePanelsBatch rejection emits exactly one error toast", () => {
    expectToast(
      { type: updatePanelsBatch.rejected.type, payload: "Failed to save panel changes." },
      "error",
      "Failed to save panel changes.",
    );
  });

  it("updatePanelColumnWidths rejection emits exactly one error toast, phrased as the user's resize", () => {
    expectToast(
      { type: updatePanelColumnWidths.rejected.type, payload: "Failed to resize columns." },
      "error",
      "Failed to resize columns.",
    );
  });

  it("savePipelineSchedule rejection (header toggle) emits exactly one error toast", () => {
    expectToast(
      { type: savePipelineSchedule.rejected.type, payload: undefined },
      "error",
      "Failed to save pipeline schedule.",
    );
  });

  it("deleteMetric rejection emits exactly one error toast", () => {
    expectToast(
      { type: deleteMetric.rejected.type, payload: undefined },
      "error",
      "Failed to delete metric.",
    );
  });

  it("deleteMetric success emits exactly one success toast (its siblings already had one)", () => {
    expectToast(
      { type: deleteMetric.fulfilled.type, payload: "met1" },
      "success",
      "Metric deleted.",
    );
  });
});
