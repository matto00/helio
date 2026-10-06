// HEL-1294 — a step card whose optimistic create (POST + resync) is in flight must not be
// expandable: the resync swaps the temp id for the persisted one, which remounts the keyed card
// collapsed, dropping an open editor (and any edit made on the temp id, a no-op). The create mock
// resolves immediately here; the RESYNC (`getPipelineSteps`) is held on a deferred promise so the
// in-flight window is deterministic.
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
import {
  analyzePipeline,
  createPipelineStep,
  fetchRunHistory,
  getPipelineById,
  getPipelineSchedule,
  getPipelineStepCatalog,
  getPipelineSteps,
  updatePipelineStep,
} from "../services/pipelineService";
import type { PipelineStepCatalog } from "../types/pipelineStepCatalog";
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

const createPipelineStepMock = jest.mocked(createPipelineStep);
const getPipelineStepsMock = jest.mocked(getPipelineSteps);
const updatePipelineStepMock = jest.mocked(updatePipelineStep);
const analyzePipelineMock = jest.mocked(analyzePipeline);

const catalog: PipelineStepCatalog = {
  groups: [
    { id: "filter-shape", label: "Filter & shape" },
    { id: "ai", label: "AI" },
  ],
  steps: [
    {
      kind: "rename",
      label: "Rename column",
      description: "Rename one or more columns.",
      group: "filter-shape",
      authorable: true,
    },
    {
      kind: "filter",
      label: "Filter rows",
      description: "Keep only matching rows.",
      group: "filter-shape",
      authorable: true,
    },
    {
      kind: "analyzewithai",
      label: "Analyze with AI",
      description: "Extract fields with AI.",
      group: "ai",
      authorable: true,
    },
  ],
};

const pipeline: PipelineSummary = {
  id: "pipe-1",
  name: "Test Pipeline",
  roots: [{ id: "root-1", dataSourceId: "src-1", dataSourceName: "Test Source" }],
  lastRunStatus: null,
  lastRunAt: null,
  lastRunRowCount: null,
};

const schema = [
  { name: "id", type: "string" },
  { name: "dept", type: "string" },
];

function persisted(id: string, type: "rename" | "filter", position: number): PipelineStep {
  const base = { id, pipelineId: "pipe-1", position, createdAt: "", updatedAt: "" };
  return type === "rename"
    ? { ...base, type, config: { renames: {} } }
    : { ...base, type, config: { combinator: "AND", conditions: [] } };
}

const analyzeResponse: PipelineAnalyzeResponse = {
  id: "pipe-1",
  name: "Test Pipeline",
  sourceSchemas: [{ rootId: "root-1", sourceSchema: schema }],
  steps: ["anchor-1", "real-1"].map((id, position) => ({
    id,
    position,
    type: "rename" as const,
    config: { renames: {} },
    inputSchema: schema,
    outputSchema: schema,
  })),
  costVerdict: { autoRunnable: true, stepCount: 1, reasons: [], canRun: true },
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

function renderPage(store = makeStore()) {
  return render(
    <MemoryRouter initialEntries={["/pipelines/pipe-1"]}>
      <ThemeProvider>
        <Provider store={store}>
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

/** Holds every `getPipelineSteps` call made AFTER the create resolves (the resync) on one deferred
 *  promise; calls before that (the page-load fetch) get `initial`. */
function holdResync(initial: PipelineStep[]) {
  let held = false;
  let release: (steps: PipelineStep[]) => void = () => {};
  const deferred = new Promise<PipelineStep[]>((resolve) => {
    release = resolve;
  });
  getPipelineStepsMock.mockImplementation(() => (held ? deferred : Promise.resolve(initial)));
  return {
    markCreateIssued: () => {
      held = true;
    },
    release: (steps: PipelineStep[]) => act(async () => release(steps)),
  };
}

async function addFilterStep() {
  fireEvent.click(screen.getByRole("button", { name: "+ Add step" }));
  fireEvent.click(await screen.findByRole("option", { name: /Filter rows/i }));
}

describe("PipelineDetailPage — step card is not expandable while its create is in flight (HEL-1294)", () => {
  beforeAll(() => {
    // jsdom doesn't implement HTMLDialogElement.showModal (the step palette opens in a dialog).
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
    jest.mocked(getPipelineStepCatalog).mockResolvedValue(catalog);
    analyzePipelineMock.mockResolvedValue(analyzeResponse);
    updatePipelineStepMock.mockResolvedValue(persisted("real-1", "rename", 0));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("disables the toggle and opens no editor until the resync lands, then edits PATCH the real id", async () => {
    const resync = holdResync([]);
    createPipelineStepMock.mockImplementation(async () => {
      resync.markCreateIssued();
      return persisted("real-1", "rename", 0);
    });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "+ Add step" }));
    fireEvent.click(await screen.findByRole("option", { name: /Rename column/i }));
    await waitFor(() => expect(createPipelineStepMock).toHaveBeenCalledTimes(1));

    // In flight: the create resolved, the resync is held.
    const toggle = screen.getByRole("button", { name: /Rename column/i });
    expect(toggle).toBeDisabled();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("textbox", { name: "New name for dept" })).not.toBeInTheDocument();

    await resync.release([persisted("real-1", "rename", 0)]);

    // Settled: the persisted card is enabled and opens; an edit PATCHes the real id.
    const settled = await screen.findByRole("button", { name: /Rename column/i, expanded: false });
    expect(settled).toBeEnabled();
    fireEvent.click(settled);
    fireEvent.change(await screen.findByRole("textbox", { name: "New name for dept" }), {
      target: { value: "department" },
    });
    await waitFor(() =>
      expect(updatePipelineStepMock).toHaveBeenCalledWith(
        "real-1",
        expect.objectContaining({ renames: expect.objectContaining({ dept: "department" }) }),
      ),
    );
  });

  it("a failed create re-enables the toggle on the kept local step", async () => {
    getPipelineStepsMock.mockResolvedValue([]);
    let rejectCreate: (err: Error) => void = () => {};
    createPipelineStepMock.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectCreate = reject;
      }),
    );
    renderPage();

    await addFilterStep();
    expect(screen.getByRole("button", { name: /Filter rows/i })).toBeDisabled();

    await act(async () => rejectCreate(new Error("Request failed with status code 500")));

    const toggle = await screen.findByRole("button", { name: /Filter rows/i, expanded: false });
    expect(toggle).toBeEnabled();
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Remove step" })).toBeInTheDocument();
  });

  it("an AI draft (no create request) stays expandable", async () => {
    getPipelineStepsMock.mockResolvedValue([]);
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "+ Add step" }));
    fireEvent.click(await screen.findByRole("option", { name: /Analyze with AI/i }));

    const toggle = screen.getByRole("button", { name: /Analyze with AI/i });
    expect(createPipelineStepMock).not.toHaveBeenCalled();
    expect(toggle).toBeEnabled();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("a lane-add step is not expandable while its create is in flight", async () => {
    const resync = holdResync([persisted("anchor-1", "rename", 0)]);
    createPipelineStepMock.mockImplementation(async () => {
      resync.markCreateIssued();
      return persisted("real-1", "filter", 1);
    });
    renderPage();
    await screen.findByRole("button", { name: /Rename column/i, expanded: false });

    fireEvent.click(screen.getByRole("button", { name: /Branch this step into a new lane/i }));
    fireEvent.click(await screen.findByRole("option", { name: /Filter rows/i }));
    await waitFor(() => expect(createPipelineStepMock).toHaveBeenCalledTimes(1));

    expect(screen.getByRole("button", { name: /Filter rows/i })).toBeDisabled();

    await resync.release([persisted("anchor-1", "rename", 0), persisted("real-1", "filter", 1)]);
    await waitFor(() => expect(screen.getByRole("button", { name: /Filter rows/i })).toBeEnabled());
  });
});
