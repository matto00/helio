// HEL-1430 -- the `?outputId=` deep link can swap the open Output editor from Output A to Output B
// while the sheet stays mounted. The per-kind editor state is seeded once per mount, so the page
// keys the sheet by Output id: B must show B's stored state, not A's leftovers.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { ThemeProvider } from "../../../theme/ThemeProvider";
import { sourcesReducer } from "../../sources/state/sourcesSlice";
import { authReducer } from "../../auth/state/authSlice";
import { dashboardsReducer } from "../../dashboards/state/dashboardsSlice";
import { layoutHistoryReducer } from "../../layout/state/layoutHistorySlice";
import { panelsReducer } from "../../panels/state/panelsSlice";
import { toastsReducer } from "../../toasts/state/toastsSlice";
import { pipelinesReducer } from "../state/pipelinesSlice";
import { outputsReducer } from "../state/outputsSlice";
import { OverlayProvider } from "../../../shared/chrome/OverlayProvider";
import { httpClient } from "../../../services/httpClient";
import { PipelineDetailPage } from "./PipelineDetailPage";
import {
  analyzePipeline,
  fetchRunHistory,
  getPipelineById,
  getPipelineSchedule,
  getPipelineStepCatalog,
  getPipelineSteps,
} from "../services/pipelineService";
import type { Output } from "../types/output";
import type { PipelineAnalyzeResponse, PipelineSummary } from "../types/pipelineStep";

jest.mock("../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
const http = jest.mocked(httpClient);

jest.mock("../services/pipelineService", () => ({
  fetchPipelines: jest.fn(),
  runPipeline: jest.fn(),
  fetchRunHistory: jest.fn(),
  getPipelineById: jest.fn(),
  getPipelineSteps: jest.fn(),
  reorderPipelineSteps: jest.fn(),
  updatePipeline: jest.fn(),
  updatePipelineStep: jest.fn(),
  updatePipelineStepEnabled: jest.fn(),
  createPipelineStep: jest.fn(),
  duplicatePipelineStep: jest.fn(),
  deletePipelineStep: jest.fn(),
  analyzePipeline: jest.fn(),
  fetchStepPreview: jest.fn(),
  getPipelineSchedule: jest.fn(),
  getPipelineStepCatalog: jest.fn(),
  getPipelineShapeCatalog: jest.fn(),
  listPipelinePermissions: jest.fn(),
}));

const pipeline: PipelineSummary = {
  id: "pipe-1",
  name: "Test Pipeline",
  roots: [{ id: "root-1", dataSourceId: "src-1", dataSourceName: "Test Source" }],
  lastRunStatus: null,
  lastRunAt: null,
  lastRunRowCount: null,
};

function mockChartOutput(id: string, chartType: string): Output {
  return {
    id,
    pipelineId: "pipe-1",
    nodeStepId: null,
    ownerId: "u-1",
    name: `Output ${id}`,
    kind: "chart",
    config: { chartType, fieldMapping: {} },
    schema: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as unknown as Output;
}

const OUTPUT_A = mockChartOutput("out-a", "bar");
const OUTPUT_B = mockChartOutput("out-b", "pie");

jest.mock("../services/outputService", () => ({
  ...jest.requireActual("../services/outputService"),
  listOutputs: async () => [mockChartOutput("out-a", "bar"), mockChartOutput("out-b", "pie")],
}));

function makeStore() {
  return configureStore({
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
    preloadedState: {
      sources: { items: [], status: "succeeded" as const, error: null },
      pipelines: {
        items: [],
        status: "idle" as const,
        error: null,
        createStatus: "idle" as const,
        createError: null,
        runId: null,
        runStatus: null,
        runError: null,
        runIsDry: null,
        runHistory: {},
        currentPipeline: pipeline,
        currentPipelineStatus: "succeeded" as const,
        currentPipelineError: null,
        steps: {},
        stepsStatus: {},
        stepsError: {},
        updateStatus: "idle" as const,
        updateError: null,
        runResult: null,
        runSourceTruncated: false,
        runSourceAvailableRowCount: null,
        runTruncationNotice: null,
        analyzeResult: {},
        analyzeStatus: {},
        analyzeError: {},
        schedule: {},
        scheduleStatus: {},
        scheduleError: {},
        scheduleSaveStatus: "idle" as const,
        scheduleSaveError: null,
      },
    } as never,
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/pipelines/pipe-1?outputId=out-a"]}>
      <ThemeProvider>
        <Provider store={makeStore()}>
          <OverlayProvider>
            <Link to="/pipelines/pipe-1?outputId=out-b">swap to B</Link>
            <Routes>
              <Route path="/pipelines/:id" element={<PipelineDetailPage />} />
            </Routes>
          </OverlayProvider>
        </Provider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  jest.mocked(fetchRunHistory).mockResolvedValue([]);
  jest.mocked(getPipelineById).mockResolvedValue(pipeline);
  jest.mocked(getPipelineSchedule).mockRejectedValue({
    isAxiosError: true,
    response: { status: 404, data: undefined },
  });
  jest.mocked(getPipelineStepCatalog).mockResolvedValue({ groups: [], steps: [] });
  jest.mocked(analyzePipeline).mockResolvedValue({
    id: "pipe-1",
    name: "Test Pipeline",
    sourceSchemas: [{ rootId: "root-1", sourceSchema: [] }],
    steps: [],
    costVerdict: { autoRunnable: true, stepCount: 0, reasons: [], canRun: true },
    warnings: [],
  } as PipelineAnalyzeResponse);
  jest.mocked(getPipelineSteps).mockResolvedValue([]);
  http.get.mockImplementation((url: string) => {
    if (url.endsWith("/panels")) return Promise.resolve({ data: [] });
    if (url.includes("/capabilities")) {
      return Promise.resolve({ data: { columns: [], capabilities: {} } });
    }
    return Promise.resolve({
      data: {
        rows: [],
        rowCount: 0,
        stepRowCounts: {},
        sourceRowCount: 0,
        blocked: false,
        sourceTruncated: false,
        truncatedReads: [],
      },
    });
  });
  http.patch.mockResolvedValue({ data: OUTPUT_B });
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("PipelineDetailPage -- Output editor deep-link swap (HEL-1430)", () => {
  it("opening Output B while Output A's editor is mounted reseeds the per-kind state from B", async () => {
    renderPage();
    const chartType = async () =>
      (await screen.findByRole("combobox", { name: "Chart type" })).textContent?.trim();
    await waitFor(async () => expect(await chartType()).toBe("Bar"));
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(OUTPUT_A.name);

    await act(async () => {
      fireEvent.click(screen.getByText("swap to B"));
    });
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(OUTPUT_B.name),
    );

    // B stores a pie chart; without a remount the chart type (per-kind state) still shows A's "Bar".
    expect(await chartType()).toBe("Pie");

    // An untouched Save of B sends no config (its baseline is B's own opening state).
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    await waitFor(() => expect(http.patch).toHaveBeenCalled());
    expect(http.patch.mock.calls[0][0]).toContain("out-b");
    expect(JSON.parse(JSON.stringify(http.patch.mock.calls[0][1]))).toEqual({
      name: OUTPUT_B.name,
    });
    expect(within(document.body).queryByText("Failed to save output.")).toBeNull();
  });
});
