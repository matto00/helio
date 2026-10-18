// HEL-1478 D1d -- characterization of the HEL-909 `?outputId=` deep link (open the Output editor
// sheet, then clear the param). Written against the effect-based implementation and kept green
// across its render-phase rewrite: every case asserts observable end states only, never the
// intermediate commit at which the sheet is still closed.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { ThemeProvider } from "../../../theme/ThemeProvider";
import { sourcesReducer } from "../../sources/state/sourcesSlice";
import { sourceSamplesReducer } from "../../sources/state/sourceSamplesSlice";
import { authReducer } from "../../auth/state/authSlice";
import { dashboardsReducer } from "../../dashboards/state/dashboardsSlice";
import { layoutHistoryReducer } from "../../layout/state/layoutHistorySlice";
import { panelsReducer } from "../../panels/state/panelsSlice";
import { toastsReducer } from "../../toasts/state/toastsSlice";
import { pipelinesReducer } from "../state/pipelinesSlice";
import { fetchOutputs, outputsReducer } from "../state/outputsSlice";
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
const mockListOutputs = jest.fn();

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

jest.mock("../services/outputService", () => ({
  ...jest.requireActual("../services/outputService"),
  listOutputs: (...args: unknown[]) => mockListOutputs(...args),
}));

/** A fresh list on every call, so each fetch gives `allOutputs` a new identity. */
const freshList = () => Promise.resolve([mockChartOutput("out-a", "bar")]);

function makeStore(preloadedOutputs: Output[] = []) {
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
      ...(preloadedOutputs.length > 0
        ? {
            outputs: {
              byPipeline: { "pipe-1": preloadedOutputs },
              listStatus: { "pipe-1": "succeeded" as const },
              listError: {},
              capabilities: {},
              capabilitiesStatus: {},
              previewByKey: {},
              previewStatus: {},
              previewError: {},
              previewRequestToken: {},
              saveStatus: "idle" as const,
              saveError: null,
              allItems: [],
              allStatus: "idle" as const,
              allError: null,
            },
          }
        : {}),
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

function LocationProbe() {
  return <span data-testid="search">{useLocation().search}</span>;
}

function renderPage(search: string, preloadedOutputs: Output[] = []) {
  const store = makeStore(preloadedOutputs);
  render(
    <MemoryRouter initialEntries={[`/pipelines/pipe-1${search}`]}>
      <ThemeProvider>
        <Provider store={store}>
          <OverlayProvider>
            <LocationProbe />
            <Routes>
              <Route path="/pipelines/:id" element={<PipelineDetailPage />} />
            </Routes>
          </OverlayProvider>
        </Provider>
      </ThemeProvider>
    </MemoryRouter>,
  );
  return store;
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
    callerRole: "owner",
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
  mockListOutputs.mockImplementation(freshList);
});

afterEach(() => {
  jest.clearAllMocks();
});

const nameBox = () => screen.queryByRole("textbox", { name: "Name" });
const search = () => screen.getByTestId("search").textContent;

describe("PipelineDetailPage -- ?outputId= deep link (HEL-909, characterized by HEL-1478)", () => {
  it("(i) opens the editor sheet for the Output named by the param", async () => {
    renderPage("?outputId=out-a");
    await waitFor(() => expect(nameBox()).toHaveValue(OUTPUT_A.name));
  });

  it("(ii) removes the param from the URL once it has opened the sheet", async () => {
    renderPage("?outputId=out-a");
    await waitFor(() => expect(nameBox()).toHaveValue(OUTPUT_A.name));
    await waitFor(() => expect(search()).toBe(""));
  });

  it("(iii) closing the sheet, then a change of the Outputs list, does not reopen it", async () => {
    const store = renderPage("?outputId=out-a");
    await waitFor(() => expect(nameBox()).toHaveValue(OUTPUT_A.name));
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(nameBox()).toBeNull());

    // A refetch (or a save elsewhere) gives `allOutputs` a new identity while the sheet is closed.
    await act(async () => {
      await store.dispatch(fetchOutputs({ pipelineId: "pipe-1" }));
    });
    await act(async () => {});
    expect(nameBox()).toBeNull();
  });

  it("(iv) a link that arrives before the Outputs load opens the sheet once they load", async () => {
    let release: (outputs: Output[]) => void = () => {};
    mockListOutputs.mockImplementationOnce(
      () => new Promise<Output[]>((resolve) => (release = resolve)),
    );
    renderPage("?outputId=out-a");
    await act(async () => {});
    expect(nameBox()).toBeNull();
    expect(search()).toBe("?outputId=out-a");

    await act(async () => {
      release([mockChartOutput("out-a", "bar")]);
    });
    await waitFor(() => expect(nameBox()).toHaveValue(OUTPUT_A.name));
  });

  it("(v) an unknown id opens nothing and leaves the param in place", async () => {
    renderPage("?outputId=does-not-exist");
    await act(async () => {});
    await act(async () => {});
    expect(nameBox()).toBeNull();
    expect(search()).toBe("?outputId=does-not-exist");
  });

  it("(vi) Outputs already in Redux at mount, list fetch still pending: the sheet opens", async () => {
    mockListOutputs.mockImplementation(() => new Promise<Output[]>(() => {}));
    renderPage("?outputId=out-a", [OUTPUT_A]);
    await waitFor(() => expect(nameBox()).toHaveValue(OUTPUT_A.name));
  });
});
