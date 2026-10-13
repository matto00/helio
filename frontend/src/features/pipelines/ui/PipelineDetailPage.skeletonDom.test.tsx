// HEL-1501 characterization: the DOM of the two river placeholders (the page-level
// `PipelineDetailSkeleton` and the steps-tab "Loading steps" skeleton). Committed green on the
// pre-extraction base so sharing one river-skeleton component can be proven markup-neutral.
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
import { PipelineDetailPage } from "./PipelineDetailPage";
import { PipelineDetailSkeleton } from "./PipelineDetailSkeleton";
import {
  analyzePipeline,
  fetchRunHistory,
  getPipelineById,
  getPipelineSchedule,
  getPipelineStepCatalog,
  getPipelineSteps,
  listPipelinePermissions,
} from "../services/pipelineService";
import type { PipelineSummary } from "../types/pipelineStep";

jest.mock("../services/pipelineService", () => ({
  fetchPipelines: jest.fn(),
  runPipeline: jest.fn(),
  fetchRunHistory: jest.fn(),
  getPipelineById: jest.fn(),
  getPipelineSteps: jest.fn(),
  updatePipeline: jest.fn(),
  analyzePipeline: jest.fn(),
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

const RIVER_INNER =
  '<div class="pipeline-detail-page__river-inner pipeline-detail-page__river-inner--skeleton">' +
  '<span class="ui-skeleton ui-skeleton--block pipeline-detail-page__ribbon" aria-hidden="true"></span>'.repeat(
    3,
  ) +
  "</div>";

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
  });
}

describe("river skeleton markup", () => {
  beforeEach(() => {
    jest.mocked(fetchRunHistory).mockResolvedValue([]);
    jest
      .mocked(getPipelineSchedule)
      .mockRejectedValue({ isAxiosError: true, response: { status: 404 } });
    jest.mocked(getPipelineStepCatalog).mockResolvedValue({ groups: [], steps: [] });
    jest.mocked(listPipelinePermissions).mockResolvedValue([] as never);
    jest.mocked(analyzePipeline).mockReturnValue(new Promise(() => {}) as never);
  });
  afterEach(() => jest.clearAllMocks());

  it("PipelineDetailSkeleton renders the recorded river block", () => {
    const { container } = render(<PipelineDetailSkeleton />);
    const river = container.querySelector(".pipeline-detail-page__river");
    expect(river?.outerHTML).toBe(`<div class="pipeline-detail-page__river">${RIVER_INNER}</div>`);
  });

  it("the steps tab renders the recorded Loading steps skeleton", async () => {
    jest.mocked(getPipelineById).mockResolvedValue(pipeline);
    jest.mocked(getPipelineSteps).mockReturnValue(new Promise(() => {}) as never);
    render(
      <MemoryRouter initialEntries={["/pipelines/pipe-1"]}>
        <ThemeProvider>
          <Provider store={makeStore()}>
            <OverlayProvider>
              <Routes>
                <Route path="/pipelines/:id" element={<PipelineDetailPage />} />
              </Routes>
            </OverlayProvider>
          </Provider>
        </ThemeProvider>
      </MemoryRouter>,
    );
    await act(async () => {});
    expect(screen.getByRole("status", { name: "Loading steps" }).outerHTML).toBe(
      `<div class="pipeline-detail-page__river" role="status" aria-label="Loading steps">${RIVER_INNER}</div>`,
    );
  });
});
