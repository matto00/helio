// usePipelineDetailPage.sourceSamples.test.tsx -- HEL-1648: which sources the pipeline page samples, and how.
// A non-owned (shared) source is requested with the page's pipelineId once analyze says the caller is an
// owner/editor -- from `callerRole`, which is permission-only, so a pipeline with an invalid step (canRun false)
// still samples. A viewer never requests it.

import { act, renderHook } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import type { ReactNode } from "react";

import { sourcesReducer } from "../../sources/state/sourcesSlice";
import { authReducer } from "../../auth/state/authSlice";
import { dashboardsReducer } from "../../dashboards/state/dashboardsSlice";
import { layoutHistoryReducer } from "../../layout/state/layoutHistorySlice";
import { panelsReducer } from "../../panels/state/panelsSlice";
import { toastsReducer } from "../../toasts/state/toastsSlice";
import { pipelinesReducer } from "../state/pipelinesSlice";
import { outputsReducer } from "../state/outputsSlice";
import { usePipelineDetailPage } from "./usePipelineDetailPage";
import {
  analyzePipeline,
  fetchRunHistory,
  getPipelineById,
  getPipelineSchedule,
  getPipelineStepCatalog,
  getPipelineSteps,
} from "../services/pipelineService";
import { listOutputs, previewOutputs } from "../services/outputService";
import { sourceSamplesReducer } from "../../sources/state/sourceSamplesSlice";
import * as dataSourceService from "../../sources/services/dataSourceService";
import type { Output } from "../types/output";
import type { PipelineStep, PipelineSummary } from "../types/pipelineStep";

jest.mock("../services/pipelineService", () => ({
  fetchPipelines: jest.fn(),
  fetchRunHistory: jest.fn(),
  getPipelineById: jest.fn(),
  getPipelineSteps: jest.fn(),
  analyzePipeline: jest.fn(),
  createPipelineStep: jest.fn(),
  runPipeline: jest.fn(),
  getPipelineSchedule: jest.fn(),
  getPipelineStepCatalog: jest.fn(),
  getPipelineShapeCatalog: jest.fn(),
}));
jest.mock("../../sources/services/dataSourceService", () => ({
  ...jest.requireActual("../../sources/services/dataSourceService"),
  fetchSourceSample: jest.fn(),
  fetchSources: jest.fn(),
  fetchSourceReferences: jest.fn().mockResolvedValue([]),
}));
jest.mock("../services/outputService", () => ({
  ...jest.requireActual("../services/outputService"),
  listOutputs: jest.fn(),
  previewOutputs: jest.fn(),
}));

const analyzeMock = jest.mocked(analyzePipeline);

const pipeline: PipelineSummary = {
  id: "pipe-1",
  name: "Test Pipeline",
  roots: [{ id: "root-1", dataSourceId: "src-1", dataSourceName: "Orders" }],
  lastRunStatus: null,
  lastRunAt: null,
  lastRunRowCount: null,
};

function wireStep(id: string, extra: Partial<PipelineStep>): PipelineStep {
  return {
    id,
    pipelineId: "pipe-1",
    position: 0,
    type: "rename",
    config: { renames: {} },
    createdAt: "",
    updatedAt: "",
    ...extra,
  } as PipelineStep;
}
const persisted = () => [
  wireStep("s1", { rootId: "root-1" }),
  wireStep("s2", { parentStepId: "s1", position: 0 }),
];

function output(id: string): Output {
  return {
    id,
    pipelineId: "pipe-1",
    nodeStepId: "s2",
    ownerId: "u1",
    name: id,
    kind: "table",
    config: {},
    schema: [],
    createdAt: "",
    updatedAt: "",
  };
}

const analyzeResponse = {
  id: "pipe-1",
  name: "Test Pipeline",
  sourceSchemas: [{ rootId: "root-1", sourceSchema: [{ name: "a", type: "string" }] }],
  steps: [],
  costVerdict: { autoRunnable: true, stepCount: 1, reasons: [], canRun: true },
  callerRole: "owner",
  warnings: [],
};

const baseState = {
  ...pipelinesReducer(undefined, { type: "@@init" }),
  currentPipeline: pipeline,
  currentPipelineStatus: "succeeded" as const,
};

function makeStore() {
  return configureStore({
    reducer: {
      auth: authReducer,
      dashboards: dashboardsReducer,
      layoutHistory: layoutHistoryReducer,
      panels: panelsReducer,
      sources: sourcesReducer,
      sourceSamples: sourceSamplesReducer,
      pipelines: pipelinesReducer,
      outputs: outputsReducer,
      toasts: toastsReducer,
    } as never,
    preloadedState: {
      sources: { items: [], status: "succeeded" as const, error: null },
      pipelines: { ...baseState, steps: { "pipe-1": persisted() } },
    } as never,
  });
}

function renderPage() {
  const store = makeStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={["/pipelines/pipe-1"]}>
      <Provider store={store}>
        <Routes>
          <Route path="/pipelines/:id" element={<>{children}</>} />
        </Routes>
      </Provider>
    </MemoryRouter>
  );
  return { ...renderHook(() => usePipelineDetailPage(), { wrapper }), store };
}

async function settle() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1000);
  });
}

const sampleBody = {
  rows: [],
  capturedAt: "2026-10-16T12:00:00Z",
  sourceRowCount: 0,
  truncated: false,
  live: false,
};

describe("usePipelineDetailPage source samples (HEL-1648)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.mocked(getPipelineById).mockResolvedValue(pipeline);
    jest.mocked(fetchRunHistory).mockResolvedValue([]);
    jest
      .mocked(getPipelineSchedule)
      .mockRejectedValue({ isAxiosError: true, response: { status: 404 } });
    jest.mocked(getPipelineStepCatalog).mockResolvedValue({ groups: [], steps: [] });
    jest.mocked(getPipelineSteps).mockResolvedValue(persisted());
    jest.mocked(listOutputs).mockResolvedValue([output("o1")]);
    jest.mocked(previewOutputs).mockResolvedValue({ outputs: [] } as never);
    jest.mocked(dataSourceService.fetchSourceSample).mockResolvedValue(sampleBody as never);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("an editor on a shared pipeline with an INVALID step (canRun false) still samples the source, scoped", async () => {
    analyzeMock.mockResolvedValue({
      ...analyzeResponse,
      callerRole: "editor",
      costVerdict: {
        autoRunnable: false,
        stepCount: 1,
        reasons: [{ code: "step-config-invalid", detail: "bad", stepId: "s1" }],
        canRun: false,
      },
    } as never);
    renderPage();
    await settle();
    expect(dataSourceService.fetchSourceSample).toHaveBeenCalledTimes(1);
    expect(dataSourceService.fetchSourceSample).toHaveBeenCalledWith("src-1", "pipe-1");
  });

  it("a viewer on a shared pipeline requests nothing", async () => {
    analyzeMock.mockResolvedValue({ ...analyzeResponse, callerRole: "viewer" } as never);
    renderPage();
    await settle();
    expect(dataSourceService.fetchSourceSample).not.toHaveBeenCalled();
  });

  it("requests nothing for a non-owned source while analyze has not answered", async () => {
    analyzeMock.mockReturnValue(new Promise(() => {}) as never);
    renderPage();
    await settle();
    expect(dataSourceService.fetchSourceSample).not.toHaveBeenCalled();
  });
});
