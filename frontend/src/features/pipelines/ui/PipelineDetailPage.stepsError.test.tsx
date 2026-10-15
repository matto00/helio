// HEL-1501 -- a failed steps fetch (this mount's own) shows a steps error with Retry instead of
// falling through to the empty editor ("No steps yet" + live Add buttons), and Retry re-issues the
// fetch. The footer must not claim "0 steps" while the steps are unknown.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import { installPhoneShell, settled } from "./pipelineDetailPageTestUtils";
import {
  analyzePipeline,
  fetchRunHistory,
  getPipelineById,
  getPipelineSchedule,
  getPipelineStepCatalog,
  getPipelineSteps,
} from "../services/pipelineService";
import type { PipelineAnalyzeResponse, PipelineStep, PipelineSummary } from "../types/pipelineStep";

jest.mock("../services/pipelineService", () => ({
  fetchPipelines: jest.fn(),
  runPipeline: jest.fn(),
  fetchRunHistory: jest.fn(),
  getPipelineById: jest.fn(),
  getPipelineSteps: jest.fn(),
  updatePipeline: jest.fn(),
  updatePipelineStep: jest.fn(),
  createPipelineStep: jest.fn(),
  deletePipelineStep: jest.fn(),
  analyzePipeline: jest.fn(),
  fetchStepPreview: jest.fn(),
  getPipelineSchedule: jest.fn(),
  getPipelineStepCatalog: jest.fn(),
  getPipelineShapeCatalog: jest.fn(),
  listPipelinePermissions: jest.fn(),
}));

const getPipelineStepsMock = jest.mocked(getPipelineSteps);
const analyzePipelineMock = jest.mocked(analyzePipeline);

const STEPS_ERROR = "Couldn't load this pipeline's steps.";

const pipeline: PipelineSummary = {
  id: "pipe-1",
  name: "Test Pipeline",
  roots: [{ id: "root-1", dataSourceId: "src-1", dataSourceName: "Test Source" }],
  lastRunStatus: null,
  lastRunAt: null,
  lastRunRowCount: null,
};

const schema = [{ name: "id", type: "string" }];

function renameStep(id: string, position: number): PipelineStep {
  return {
    id,
    pipelineId: "pipe-1",
    position,
    type: "rename",
    config: { renames: {} },
    createdAt: "",
    updatedAt: "",
  };
}

const persistedSteps = [renameStep("s1", 0), renameStep("s2", 1)];

const analyzeResponse: PipelineAnalyzeResponse = {
  id: "pipe-1",
  name: "Test Pipeline",
  sourceSchemas: [{ rootId: "root-1", sourceSchema: schema }],
  steps: persistedSteps.map((s) => ({
    id: s.id,
    position: s.position,
    type: "rename" as const,
    config: { renames: {} },
    inputSchema: schema,
    outputSchema: schema,
  })),
  costVerdict: { autoRunnable: true, stepCount: 2, reasons: [], canRun: true },
  warnings: [],
};

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

function renderPage() {
  return render(
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
}

const cardButtons = () => screen.queryAllByRole("button", { name: /Rename column/i });
const footerStats = () => document.querySelector(".pipeline-detail-page__footer-stats");

// HEL-1579: the legacy page tests assert the phone layout (river view, cards, tabs, footer) and layout-independent
// page logic reached through the phone's card DOM; jsdom has no `matchMedia`, so stub the phone shell. The desktop
// step spine has its own tests (`PipelineDetailPage.spine*.test.tsx`).
let restorePhoneShell: () => void = () => {};
beforeEach(() => {
  restorePhoneShell = installPhoneShell();
});
afterEach(() => {
  restorePhoneShell();
});

describe("PipelineDetailPage -- steps fetch failure (HEL-1501)", () => {
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    });
  });

  beforeEach(() => {
    jest.mocked(fetchRunHistory).mockResolvedValue([]);
    jest.mocked(getPipelineById).mockResolvedValue(pipeline);
    jest.mocked(getPipelineSchedule).mockRejectedValue({
      isAxiosError: true,
      response: { status: 404, data: undefined },
    });
    jest.mocked(getPipelineStepCatalog).mockResolvedValue({
      groups: [{ id: "filter-shape", label: "Filter & shape" }],
      steps: [
        {
          kind: "rename",
          label: "Rename column",
          description: "Rename one or more columns.",
          group: "filter-shape",
          authorable: true,
        },
      ],
    });
    analyzePipelineMock.mockResolvedValue(analyzeResponse);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("shows the steps error with Retry, not the empty editor, when the steps fetch rejects", async () => {
    getPipelineStepsMock.mockRejectedValue(new Error("boom"));
    await settled(renderPage());

    expect(await screen.findByText(STEPS_ERROR)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("No steps yet")).toBeNull();
    expect(screen.queryByRole("button", { name: "+ Add step" })).toBeNull();
    // Inside the river frame, so it gets the same inset as the skeleton and the cards.
    expect(screen.getByRole("alert").closest(".pipeline-detail-page__river")).not.toBeNull();
    // The raw rejection text is not user copy.
    expect(screen.queryByText(/boom/)).toBeNull();
  });

  it("does not report a step count while the steps are unknown (no '0 steps')", async () => {
    getPipelineStepsMock.mockRejectedValue(new Error("boom"));
    await settled(renderPage());

    await screen.findByText(STEPS_ERROR);
    expect(footerStats()).toBeNull();
    expect(screen.queryByText(/\b0 steps\b/)).toBeNull();
  });

  it("Retry shows the steps skeleton while in flight, then the persisted step cards", async () => {
    getPipelineStepsMock.mockRejectedValueOnce(new Error("boom"));
    await settled(renderPage());
    await screen.findByText(STEPS_ERROR);

    let release: (steps: PipelineStep[]) => void = () => {};
    getPipelineStepsMock.mockReturnValueOnce(
      new Promise<PipelineStep[]>((resolve) => {
        release = resolve;
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(screen.getByRole("status", { name: "Loading steps" })).toBeInTheDocument();
    expect(screen.queryByText(STEPS_ERROR)).toBeNull();
    expect(screen.queryByText("No steps yet")).toBeNull();

    await act(async () => release(persistedSteps));

    await waitFor(() => expect(cardButtons()).toHaveLength(2));
    expect(screen.queryByText(STEPS_ERROR)).toBeNull();
    expect(screen.queryByRole("status", { name: "Loading steps" })).toBeNull();
    expect(footerStats()).toHaveTextContent("2 steps");
    expect(getPipelineStepsMock).toHaveBeenCalledTimes(2);
  });

  it("Retry that fails again shows the error again", async () => {
    getPipelineStepsMock.mockRejectedValue(new Error("boom"));
    await settled(renderPage());
    await screen.findByText(STEPS_ERROR);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText(STEPS_ERROR)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("No steps yet")).toBeNull();
    expect(getPipelineStepsMock).toHaveBeenCalledTimes(2);
  });

  it("when analyze also failed at mount, a successful Retry re-requests analyze once", async () => {
    getPipelineStepsMock.mockRejectedValueOnce(new Error("boom"));
    analyzePipelineMock.mockRejectedValueOnce(new Error("boom"));
    await settled(renderPage());
    await screen.findByText(STEPS_ERROR);
    expect(analyzePipelineMock).toHaveBeenCalledTimes(1);

    getPipelineStepsMock.mockResolvedValueOnce(persistedSteps);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(cardButtons()).toHaveLength(2));
    // Let the seeded steps' debounced re-analyze window pass: the seed must not add a second one.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });

    expect(analyzePipelineMock).toHaveBeenCalledTimes(2);
  });

  it("when analyze succeeded at mount, Retry does not re-request it", async () => {
    getPipelineStepsMock.mockRejectedValueOnce(new Error("boom"));
    await settled(renderPage());
    await screen.findByText(STEPS_ERROR);
    expect(analyzePipelineMock).toHaveBeenCalledTimes(1);

    getPipelineStepsMock.mockResolvedValueOnce(persistedSteps);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(cardButtons()).toHaveLength(2));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });

    expect(analyzePipelineMock).toHaveBeenCalledTimes(1);
  });

  it("a Retry that settles after the page unmounted dispatches no analyze", async () => {
    getPipelineStepsMock.mockRejectedValueOnce(new Error("boom"));
    analyzePipelineMock.mockRejectedValueOnce(new Error("boom"));
    const { unmount } = await settled(renderPage());
    await screen.findByText(STEPS_ERROR);

    let release: (steps: PipelineStep[]) => void = () => {};
    getPipelineStepsMock.mockReturnValueOnce(
      new Promise<PipelineStep[]>((resolve) => {
        release = resolve;
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    unmount();
    await act(async () => release(persistedSteps));

    expect(analyzePipelineMock).toHaveBeenCalledTimes(1);
  });
});
