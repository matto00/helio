// HEL-1704 key-set GUARD (not a red-first test): the keys `usePipelineDetailPage` and `usePipelineDraftSave` return were recorded
// on main before the split. A refactor that drops, renames or leaks a key turns it red (recorded mutation in evidence.md).

import { renderHook } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";

import { authReducer } from "../../auth/state/authSlice";
import { dashboardsReducer } from "../../dashboards/state/dashboardsSlice";
import { layoutHistoryReducer } from "../../layout/state/layoutHistorySlice";
import { panelsReducer } from "../../panels/state/panelsSlice";
import { sourcesReducer } from "../../sources/state/sourcesSlice";
import { toastsReducer } from "../../toasts/state/toastsSlice";
import { outputsReducer } from "../state/outputsSlice";
import { pipelinesReducer } from "../state/pipelinesSlice";
import { usePipelineDetailPage } from "./usePipelineDetailPage";
import { usePipelineDraftSave } from "./usePipelineDraftSave";

jest.mock("../services/outputService", () => ({
  ...jest.requireActual("../services/outputService"),
  listOutputs: jest.fn(() => Promise.reject(new Error("listOutputs stubbed"))),
}));
jest.mock("../../sources/services/dataSourceService", () => ({
  ...jest.requireActual("../../sources/services/dataSourceService"),
  fetchSources: jest.fn(() => Promise.reject(new Error("fetchSources stubbed"))),
}));
jest.mock("../services/pipelineService", () => ({
  fetchPipelines: jest.fn(() => Promise.reject(new Error("stubbed"))),
  fetchRunHistory: jest.fn(() => Promise.reject(new Error("stubbed"))),
  getPipelineById: jest.fn(() => Promise.reject(new Error("stubbed"))),
  getPipelineSteps: jest.fn(() => Promise.reject(new Error("stubbed"))),
  analyzePipeline: jest.fn(() => Promise.reject(new Error("stubbed"))),
  getPipelineSchedule: jest.fn(() => Promise.reject(new Error("stubbed"))),
  getPipelineStepCatalog: jest.fn(() => Promise.reject(new Error("stubbed"))),
  getPipelineShapeCatalog: jest.fn(() => Promise.reject(new Error("stubbed"))),
}));

const EXPECTED_KEYS: string[] = [
  "allOutputs",
  "analyzeSourceSchemas",
  "baseSteps",
  "closeRunHistory",
  "confirmCancelDiscard",
  "costVerdict",
  "creatingStepIds",
  "currentPipeline",
  "currentPipelineError",
  "currentPipelineErrorKind",
  "currentPipelineStatus",
  "dismissCancelConfirm",
  "dispatch",
  "draft",
  "draftBlockReason",
  "draftCreateErrors",
  "draftFrameMemory",
  "draftOutputBlockReason",
  "draftOutputEditedIds",
  "draftOutputs",
  "draftSave",
  "dropdownOpenAt",
  "duplicatingStepIds",
  "editingOutputName",
  "ensureRunHistoryLoaded",
  "estimatedRows",
  "getAnalyzeColumns",
  "getAnalyzeOutputSchema",
  "getAnalyzeSchema",
  "getAnalyzeValidationError",
  "getAnalyzeWarnings",
  "handleAddLaneStep",
  "handleAddOutput",
  "handleAddOutputViaAggregateTail",
  "handleAddRoot",
  "handleAddStep",
  "handleCancel",
  "handleCloseOutputHistory",
  "handleCloseOutputSheet",
  "handleCreateOutput",
  "handleDeleteOutput",
  "handleDryRun",
  "handleDuplicateStep",
  "handleEditSource",
  "handleInsertStep",
  "handleInstantiateShape",
  "handleOpenOutput",
  "handleOpenOutputHistory",
  "handleRemoveRoot",
  "handleRemoveStep",
  "handleReorderSteps",
  "handleRunPipeline",
  "handleRunToUpdate",
  "handleSave",
  "handleStepConfigChange",
  "handleToggleScheduleEnabled",
  "handleToggleStepEnabled",
  "handleUpdateOutput",
  "hasOwnAnalyzeEntry",
  "historyOpen",
  "historyOutput",
  "id",
  "isConfirmingCancel",
  "isDirty",
  "isOwner",
  "laneGraph",
  "openRunHistory",
  "outputName",
  "outputPickRemap",
  "outputSheet",
  "outputsByStepId",
  "pipelineName",
  "pipelineSchedule",
  "previewRowCountByOutputId",
  "retryPipelineLoad",
  "retryRunHistory",
  "retryStepsLoad",
  "roots",
  "runError",
  "runHistoryView",
  "runIsDry",
  "runResult",
  "runRole",
  "runSourceRowCount",
  "runSourceTruncated",
  "runStatus",
  "runStepRowCounts",
  "runTruncationNotice",
  "runs",
  "savedRoots",
  "scheduleOpen",
  "setDropdownOpenAt",
  "setEditingOutputName",
  "setOutputName",
  "setScheduleOpen",
  "setShareOpen",
  "setSheetDraftNode",
  "setSheetNodeStepId",
  "shareOpen",
  "sheetDraftNode",
  "sheetNodeStepId",
  "sourceByRootId",
  "sseActive",
  "sseData",
  "steps",
  "stepsFailed",
  "stepsLoading",
  "updateError",
  "updateStatus",
];

function renderPage() {
  const store = configureStore({
    reducer: {
      auth: authReducer,
      dashboards: dashboardsReducer,
      layoutHistory: layoutHistoryReducer,
      panels: panelsReducer,
      sources: sourcesReducer,
      pipelines: pipelinesReducer,
      outputs: outputsReducer,
      toasts: toastsReducer,
    } as never,
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={["/pipelines/pipe-1"]}>
      <Provider store={store}>
        <Routes>
          <Route path="/pipelines/:id" element={<>{children}</>} />
        </Routes>
      </Provider>
    </MemoryRouter>
  );
  return renderHook(() => usePipelineDetailPage(), { wrapper });
}

describe("[guard] usePipelineDetailPage returned keys", () => {
  it("returns exactly the keys recorded on main plus the HEL-1733 draft Output keys", () => {
    const { result } = renderPage();
    expect(Object.keys(result.current).sort()).toEqual(EXPECTED_KEYS);
  });
});

describe("[guard] usePipelineDraftSave returned keys", () => {
  it("returns exactly the keys recorded on main plus the HEL-1733 draft Output keys", () => {
    const { result } = renderHook(
      () =>
        usePipelineDraftSave({
          id: "pipe-1",
          dispatch: jest.fn() as never,
          pushToast: jest.fn() as never,
          draft: {
            overlayRef: { current: { ops: [] } },
            staleRestoredRef: { current: false },
            staleRestored: false,
            draftSteps: [],
            droppedCount: 0,
            clearDropped: jest.fn(),
          } as never,
          stepsRef: { current: [] },
          setSteps: jest.fn(),
          roots: [],
          allOutputsRef: { current: [] },
          draftSaveInFlightRef: { current: false },
          setOutputPickRemap: jest.fn(),
          outputsLoaded: false,
          setSseActive: jest.fn(),
          refreshRunHistoryAfterRun: jest.fn(),
          refreshVisibleOutputPreviews: jest.fn(),
          onRunNow: jest.fn(),
        }),
      {
        wrapper: ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>,
      },
    );
    expect(Object.keys(result.current).sort()).toEqual([
      "cancelCascade",
      "cascade",
      "confirmCascade",
      "confirmUndoWithDraft",
      "dismissNotice",
      "notice",
      "reload",
      "saveAndRun",
      "saving",
    ]);
  });
});
