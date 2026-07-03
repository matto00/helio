import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { ThemeProvider } from "../../../theme/ThemeProvider";
import { sourcesReducer } from "../../sources/state/sourcesSlice";
import { authReducer } from "../../auth/state/authSlice";
import { dashboardsReducer } from "../../dashboards/state/dashboardsSlice";
import { layoutHistoryReducer } from "../../layout/state/layoutHistorySlice";
import { panelsReducer } from "../../panels/state/panelsSlice";
import { dataTypesReducer } from "../../dataTypes/state/dataTypesSlice";
import { pipelinesReducer } from "../state/pipelinesSlice";
import { OverlayProvider } from "../../../shared/chrome/OverlayProvider";
import { PipelineDetailPage } from "./PipelineDetailPage";
import {
  runPipeline,
  fetchRunHistory,
  getPipelineById,
  getPipelineSteps,
  updatePipeline,
  updatePipelineStep,
  createPipelineStep,
  deletePipelineStep,
  analyzePipeline,
  fetchStepPreview,
} from "../services/pipelineService";
import type {
  PipelineAnalyzeResponse,
  PipelineRunRecord,
  PipelineStep,
  PipelineSummary,
} from "../types/pipelineStep";

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
}));

const runPipelineMock = jest.mocked(runPipeline);
const fetchRunHistoryMock = jest.mocked(fetchRunHistory);
const getPipelineByIdMock = jest.mocked(getPipelineById);
const getPipelineStepsMock = jest.mocked(getPipelineSteps);
const updatePipelineMock = jest.mocked(updatePipeline);
const updatePipelineStepMock = jest.mocked(updatePipelineStep);
const createPipelineStepMock = jest.mocked(createPipelineStep);
const deletePipelineStepMock = jest.mocked(deletePipelineStep);
const analyzePipelineMock = jest.mocked(analyzePipeline);
const fetchStepPreviewMock = jest.mocked(fetchStepPreview);

const emptyAnalyzeResponse: PipelineAnalyzeResponse = {
  id: "pipe-1",
  name: "Test Pipeline",
  sourceDataSourceName: "Test Source",
  outputDataTypeName: "TestType",
  outputDataTypeId: "dt-1",
  sourceSchema: [],
  steps: [],
};

const defaultPipeline: PipelineSummary = {
  id: "pipe-1",
  name: "Test Pipeline",
  sourceDataSourceName: "Test Source",
  outputDataTypeName: "TestType",
  lastRunStatus: null,
  lastRunAt: null,
  lastRunRowCount: null,
};

// Source fixture shape — uses the same discriminated-union as production code.
import type { DataSource } from "../../sources/types/dataSource";
type SourceItem = DataSource;

type PipelinesPreloadedState = {
  runId?: string | null;
  runStatus?: "queued" | "running" | "succeeded" | "failed" | null;
  runError?: string | null;
  runIsDry?: boolean | null;
  runHistory?: Record<string, PipelineRunRecord[]>;
  runResult?: Record<string, unknown>[] | null;
  currentPipeline?: PipelineSummary | null;
  currentPipelineStatus?: "idle" | "loading" | "succeeded" | "failed";
  currentPipelineError?: string | null;
  updateStatus?: "idle" | "loading" | "succeeded" | "failed";
  updateError?: string | null;
};

function makeStore(sourcesItems: SourceItem[] = [], pipelinesState: PipelinesPreloadedState = {}) {
  return configureStore({
    reducer: {
      auth: authReducer,
      dashboards: dashboardsReducer,
      layoutHistory: layoutHistoryReducer,
      panels: panelsReducer,
      dataTypes: dataTypesReducer,
      sources: sourcesReducer,
      pipelines: pipelinesReducer,
    } as never,
    preloadedState: {
      sources: {
        items: sourcesItems,
        status: "succeeded" as const,
        error: null,
      },
      pipelines: {
        items: [],
        status: "idle" as const,
        error: null,
        createStatus: "idle" as const,
        createError: null,
        runId: pipelinesState.runId ?? null,
        runStatus: pipelinesState.runStatus ?? null,
        runError: pipelinesState.runError ?? null,
        runIsDry: pipelinesState.runIsDry ?? null,
        runHistory: pipelinesState.runHistory ?? {},
        currentPipeline:
          "currentPipeline" in pipelinesState ? pipelinesState.currentPipeline : defaultPipeline,
        currentPipelineStatus: pipelinesState.currentPipelineStatus ?? "succeeded",
        currentPipelineError: pipelinesState.currentPipelineError ?? null,
        steps: {},
        stepsStatus: {},
        stepsError: {},
        updateStatus: pipelinesState.updateStatus ?? "idle",
        updateError: pipelinesState.updateError ?? null,
        runResult: pipelinesState.runResult ?? null,
        analyzeResult: {},
        analyzeStatus: {},
        analyzeError: {},
      },
    } as never,
  });
}

function renderDetailPage(id = "pipe-1", store = makeStore()) {
  return render(
    <MemoryRouter initialEntries={[`/pipelines/${id}`]}>
      <ThemeProvider>
        <Provider store={store}>
          <OverlayProvider>
            <Routes>
              <Route path="/pipelines/:id" element={<PipelineDetailPage />} />
              <Route path="/pipelines" element={<div>Pipelines List</div>} />
            </Routes>
          </OverlayProvider>
        </Provider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe("PipelineDetailPage", () => {
  beforeAll(() => {
    // jsdom doesn't implement HTMLDialogElement.showModal — stub it for the
    // RunHistoryModal opens.
    HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    });
  });

  beforeEach(() => {
    runPipelineMock.mockResolvedValue({
      rowCount: 0,
      rows: [],
      stepRowCounts: {},
      sourceRowCount: 0,
    });
    fetchRunHistoryMock.mockResolvedValue([]);
    getPipelineByIdMock.mockResolvedValue(defaultPipeline);
    getPipelineStepsMock.mockResolvedValue([]);
    analyzePipelineMock.mockResolvedValue(emptyAnalyzeResponse);
    deletePipelineStepMock.mockResolvedValue(undefined);
    updatePipelineMock.mockResolvedValue(defaultPipeline);
    updatePipelineStepMock.mockResolvedValue({
      id: "step-1",
      pipelineId: "pipe-1",
      position: 0,
      type: "select",
      config: { fields: [] },
      createdAt: "",
      updatedAt: "",
    });
    createPipelineStepMock.mockResolvedValue({
      id: "step-uuid-new",
      pipelineId: "pipe-1",
      position: 0,
      type: "select",
      config: { fields: [] },
      createdAt: "",
      updatedAt: "",
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("renders when route is /pipelines/:id", async () => {
    renderDetailPage();
    expect(screen.getByText("Run pipeline")).toBeInTheDocument();
  });

  // The in-page back-navigation link was removed — the top command bar's
  // section breadcrumb ("Data Pipelines / <name>") now handles that, and is
  // covered by App.test.tsx.

  it("source selector renders sources from store", () => {
    const store = makeStore([
      {
        id: "src-1",
        name: "Sales DB",
        type: "sql",
        createdAt: "",
        updatedAt: "",
        config: {
          dialect: "postgresql",
          host: "h",
          port: 5432,
          database: "d",
          user: "u",
          password: "p",
          query: "SELECT 1",
        },
      },
      {
        id: "src-2",
        name: "CSV Upload",
        type: "csv",
        createdAt: "",
        updatedAt: "",
        config: { path: "uploads/test.csv" },
      },
    ]);
    renderDetailPage("pipe-1", store);
    expect(screen.getByText("Sales DB")).toBeInTheDocument();
    expect(screen.getByText("CSV Upload")).toBeInTheDocument();
  });

  it("empty state shows 'Add your first transformation step' when steps is empty", () => {
    renderDetailPage();
    expect(screen.getByText("Add your first transformation step")).toBeInTheDocument();
  });

  it("adding a step adds a card to the river view", () => {
    renderDetailPage();

    fireEvent.click(screen.getByRole("button", { name: "+ Add step" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Filter rows/i }));

    expect(screen.getByText("Filter rows")).toBeInTheDocument();
    expect(screen.queryByText("Add your first transformation step")).not.toBeInTheDocument();
  });

  it("removing a step removes its card", () => {
    renderDetailPage();

    // Add a step first
    fireEvent.click(screen.getByRole("button", { name: "+ Add step" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Rename column/i }));

    // Expand it to get the Remove button
    fireEvent.click(screen.getByRole("button", { name: /Rename column/i, expanded: false }));
    fireEvent.click(screen.getByRole("button", { name: "Remove step" }));

    expect(screen.queryByText("Rename column")).not.toBeInTheDocument();
    expect(screen.getByText("Add your first transformation step")).toBeInTheDocument();
    // A never-persisted (temp) step has no backend row, so no DELETE is issued.
    expect(deletePipelineStepMock).not.toHaveBeenCalled();
  });

  it("removing a persisted step deletes it on the backend", async () => {
    getPipelineStepsMock.mockResolvedValue([
      {
        id: "abc-123-def",
        pipelineId: "pipe-1",
        position: 0,
        type: "rename",
        config: { renames: {} },
        createdAt: "",
        updatedAt: "",
      },
    ]);

    renderDetailPage();

    // The step renders from the fetched (already-persisted) data with its real id.
    const card = await screen.findByRole("button", {
      name: /Rename column/i,
      expanded: false,
    });
    fireEvent.click(card);
    fireEvent.click(screen.getByRole("button", { name: "Remove step" }));

    expect(screen.queryByText("Rename column")).not.toBeInTheDocument();
    await waitFor(() => expect(deletePipelineStepMock).toHaveBeenCalledWith("abc-123-def"));
  });

  it("output name field is editable — input appears on click", async () => {
    const store = makeStore([], {
      currentPipeline: {
        id: "pipe-1",
        name: "My Pipeline",
        sourceDataSourceName: "Source",
        outputDataTypeName: "Type",
        lastRunStatus: null,
        lastRunAt: null,
        lastRunRowCount: null,
      },
      currentPipelineStatus: "succeeded",
    });
    renderDetailPage("pipe-1", store);

    const outputNameBtn = await screen.findByRole("button", { name: "Edit output name" });
    fireEvent.click(outputNameBtn);

    const input = screen.getByRole("textbox", { name: "Output name" });
    expect(input).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "New Output" } });
    expect(input).toHaveValue("New Output");
  });

  it("clicking Run pipeline dispatches submitPipelineRun", async () => {
    renderDetailPage("pipe-1");

    fireEvent.click(screen.getByRole("button", { name: "Run pipeline" }));

    await waitFor(() => {
      expect(runPipelineMock).toHaveBeenCalledWith("pipe-1", undefined);
    });
  });

  it("status indicator shows 'Queued' when runStatus is queued", () => {
    const store = makeStore([], { runStatus: "queued", runId: "run-1" });
    renderDetailPage("pipe-1", store);
    expect(screen.getByLabelText("Run status: queued")).toBeInTheDocument();
    expect(screen.getByText("Queued…")).toBeInTheDocument();
  });

  it("status indicator shows 'Running' when runStatus is running", () => {
    const store = makeStore([], { runStatus: "running", runId: "run-2" });
    renderDetailPage("pipe-1", store);
    expect(screen.getByText("Running…")).toBeInTheDocument();
  });

  it("status indicator shows 'Snapshot replaced' when runStatus is succeeded (non-dry)", () => {
    const store = makeStore([], {
      runStatus: "succeeded",
      runId: "run-3",
      runIsDry: false,
      runResult: [{ a: 1 }, { a: 2 }],
    });
    renderDetailPage("pipe-1", store);
    expect(screen.getByLabelText("Run status: succeeded")).toHaveTextContent(
      "Snapshot replaced: 2 rows",
    );
  });

  it("status indicator shows 'Failed' when runStatus is failed", () => {
    const store = makeStore([], { runStatus: "failed", runId: "run-4", runError: "out of memory" });
    renderDetailPage("pipe-1", store);
    expect(screen.getByText(/Failed.*out of memory/)).toBeInTheDocument();
  });

  it("status indicator is absent when runStatus is null", () => {
    renderDetailPage();
    expect(screen.queryByLabelText(/Run status/)).not.toBeInTheDocument();
  });

  it("run history button shows empty count when no runs", () => {
    renderDetailPage();
    expect(screen.getByRole("button", { name: /Open run history/i })).toHaveTextContent(
      /Run history\s*\(0\)/i,
    );
  });

  it("run history modal shows runs from store after opening", () => {
    const run: PipelineRunRecord = {
      id: "run-1",
      pipelineId: "pipe-1",
      status: "succeeded",
      startedAt: "2026-05-01T10:00:00Z",
      completedAt: "2026-05-01T10:01:00Z",
      rowCount: 42,
      errorLog: null,
    };
    const store = makeStore([], { runHistory: { "pipe-1": [run] } });
    renderDetailPage("pipe-1", store);
    fireEvent.click(screen.getByRole("button", { name: /Open run history/i }));
    expect(screen.getByText("42 rows")).toBeInTheDocument();
  });

  it("failed run shows a Show log toggle in the run history modal", async () => {
    const run: PipelineRunRecord = {
      id: "run-2",
      pipelineId: "pipe-1",
      status: "failed",
      startedAt: "2026-05-01T11:00:00Z",
      completedAt: "2026-05-01T11:00:05Z",
      rowCount: null,
      errorLog: "out of memory error",
    };
    const store = makeStore([], { runHistory: { "pipe-1": [run] } });
    renderDetailPage("pipe-1", store);
    fireEvent.click(screen.getByRole("button", { name: /Open run history/i }));
    fireEvent.click(screen.getByRole("button", { name: "Show log" }));
    expect(screen.getByText("out of memory error")).toBeInTheDocument();
  });

  it("dispatches fetchPipelineRunHistory on mount", async () => {
    renderDetailPage("pipe-1");
    await waitFor(() => {
      expect(fetchRunHistoryMock).toHaveBeenCalledWith("pipe-1");
    });
  });

  it("meta bar is absent when currentPipeline.lastRunAt is null", () => {
    // defaultPipeline has lastRunAt: null
    renderDetailPage();
    expect(screen.queryByLabelText("Last run metadata")).not.toBeInTheDocument();
  });

  it("meta bar is visible when currentPipeline.lastRunAt is non-null", () => {
    const store = makeStore([], {
      currentPipeline: {
        id: "pipe-1",
        name: "Test Pipeline",
        sourceDataSourceName: "Test Source",
        outputDataTypeName: "TestType",
        lastRunStatus: "succeeded",
        lastRunAt: "2026-05-01T10:00:00Z",
        lastRunRowCount: 42,
      },
      currentPipelineStatus: "succeeded",
    });
    renderDetailPage("pipe-1", store);
    expect(screen.getByLabelText("Last run metadata")).toBeInTheDocument();
  });

  it("meta bar shows row count when lastRunRowCount is non-null", () => {
    const store = makeStore([], {
      currentPipeline: {
        id: "pipe-1",
        name: "Test Pipeline",
        sourceDataSourceName: "Test Source",
        outputDataTypeName: "TestType",
        lastRunStatus: "succeeded",
        lastRunAt: "2026-05-01T10:00:00Z",
        lastRunRowCount: 5678,
      },
      currentPipelineStatus: "succeeded",
    });
    renderDetailPage("pipe-1", store);
    expect(screen.getByText("5,678")).toBeInTheDocument();
  });

  it("meta bar does not crash when lastRunRowCount is undefined", () => {
    // Simulates old Redux state (e.g. demo data) where the field is absent at
    // runtime. Cast bypasses TypeScript so we can test the JS-level guard.
    // The loose-equality guard (!= null) must protect against both null and undefined.
    const store = makeStore([], {
      currentPipeline: {
        id: "pipe-1",
        name: "Test Pipeline",
        sourceDataSourceName: "Test Source",
        outputDataTypeName: "TestType",
        lastRunStatus: "succeeded",
        lastRunAt: "2026-05-01T10:00:00Z",
        lastRunRowCount: undefined,
      } as unknown as PipelineSummary,
      currentPipelineStatus: "succeeded",
    });
    // Should not throw — this was the regression introduced by using !== null
    expect(() => renderDetailPage("pipe-1", store)).not.toThrow();
    // Meta bar is present (lastRunAt is non-null) but row-count item is absent
    expect(screen.getByLabelText("Last run metadata")).toBeInTheDocument();
    expect(screen.queryByText("Rows written:")).not.toBeInTheDocument();
  });
});

// ── Task 4.4 — loading state ─────────────────────────────────────────────────

describe("PipelineDetailPage loading state", () => {
  beforeEach(() => {
    fetchRunHistoryMock.mockResolvedValue([]);
    // Never-resolving promise keeps the component in "loading" state
    getPipelineByIdMock.mockReturnValue(new Promise<never>(() => {}));
    getPipelineStepsMock.mockReturnValue(new Promise<never>(() => {}));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("shows loading indicator while currentPipelineStatus is loading", () => {
    // currentPipeline: null → conditional dispatch fires → pending sets "loading"
    const store = makeStore([], {
      currentPipelineStatus: "idle",
      currentPipeline: null,
    });
    renderDetailPage("pipe-1", store);
    expect(screen.getByLabelText("Loading pipeline")).toBeInTheDocument();
  });

  it("does not render pipeline content while loading", () => {
    const store = makeStore([], {
      currentPipelineStatus: "idle",
      currentPipeline: null,
    });
    renderDetailPage("pipe-1", store);
    expect(screen.queryByText("Run pipeline")).not.toBeInTheDocument();
  });
});

// ── Task 4.5 — error state ───────────────────────────────────────────────────

describe("PipelineDetailPage error state", () => {
  beforeEach(() => {
    fetchRunHistoryMock.mockResolvedValue([]);
    getPipelineByIdMock.mockResolvedValue(defaultPipeline);
    getPipelineStepsMock.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("shows error message when currentPipelineStatus is failed", () => {
    // currentPipeline: null + status "failed" → fetch effect skips (guards on "failed"),
    // and the "failed" guard in render returns the error element immediately.
    const store = makeStore([], {
      currentPipelineStatus: "failed",
      currentPipelineError: "Failed to load pipeline.",
      currentPipeline: null,
    });
    renderDetailPage("pipe-1", store);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Failed to load pipeline.")).toBeInTheDocument();
  });

  it("does not render pipeline editor on failure", () => {
    const store = makeStore([], {
      currentPipelineStatus: "failed",
      currentPipelineError: "Something went wrong",
      currentPipeline: null,
    });
    renderDetailPage("pipe-1", store);
    expect(screen.queryByText("Run pipeline")).not.toBeInTheDocument();
  });
});

// ── Task 4.6 — dirty-state detection ─────────────────────────────────────────

describe("PipelineDetailPage dirty-state detection", () => {
  beforeEach(() => {
    fetchRunHistoryMock.mockResolvedValue([]);
    getPipelineByIdMock.mockResolvedValue(defaultPipeline);
    getPipelineStepsMock.mockResolvedValue([]);
    updatePipelineMock.mockResolvedValue(defaultPipeline);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("Save and Cancel buttons are not visible when name matches original", async () => {
    renderDetailPage("pipe-1");
    // Wait for the component to settle after effects
    await act(async () => {});
    expect(screen.queryByLabelText("Save pipeline")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Cancel changes")).not.toBeInTheDocument();
  });

  it("Save and Cancel appear when output name is edited to differ from loaded name", async () => {
    renderDetailPage("pipe-1");
    await act(async () => {});

    // Click the output name button to enter edit mode
    const editBtn = await screen.findByRole("button", { name: "Edit output name" });
    fireEvent.click(editBtn);

    // Change the name
    const input = screen.getByRole("textbox", { name: "Output name" });
    fireEvent.change(input, { target: { value: "Changed Name" } });
    fireEvent.blur(input);

    // Save and Cancel should now appear
    await waitFor(() => {
      expect(screen.getByLabelText("Save pipeline")).toBeInTheDocument();
      expect(screen.getByLabelText("Cancel changes")).toBeInTheDocument();
    });
  });

  it("Save and Cancel disappear when name is restored to original", async () => {
    renderDetailPage("pipe-1");
    await act(async () => {});

    const editBtn = await screen.findByRole("button", { name: "Edit output name" });
    fireEvent.click(editBtn);

    const input = screen.getByRole("textbox", { name: "Output name" });
    fireEvent.change(input, { target: { value: "Changed Name" } });
    fireEvent.blur(input);

    await waitFor(() => expect(screen.getByLabelText("Save pipeline")).toBeInTheDocument());

    // Restore original name
    const editBtn2 = screen.getByRole("button", { name: "Edit output name" });
    fireEvent.click(editBtn2);
    const input2 = screen.getByRole("textbox", { name: "Output name" });
    fireEvent.change(input2, { target: { value: defaultPipeline.name } });
    fireEvent.blur(input2);

    await waitFor(() => {
      expect(screen.queryByLabelText("Save pipeline")).not.toBeInTheDocument();
    });
  });
});

// ── Task 4.7 — Cancel confirmation flow ─────────────────────────────────────

describe("PipelineDetailPage Cancel confirmation", () => {
  beforeEach(() => {
    fetchRunHistoryMock.mockResolvedValue([]);
    getPipelineByIdMock.mockResolvedValue(defaultPipeline);
    getPipelineStepsMock.mockResolvedValue([]);
    updatePipelineMock.mockResolvedValue(defaultPipeline);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  async function makeDirty() {
    await act(async () => {});
    const editBtn = await screen.findByRole("button", { name: "Edit output name" });
    fireEvent.click(editBtn);
    const input = screen.getByRole("textbox", { name: "Output name" });
    fireEvent.change(input, { target: { value: "Dirty Name" } });
    fireEvent.blur(input);
    await waitFor(() => expect(screen.getByLabelText("Cancel changes")).toBeInTheDocument());
  }

  it("navigates to /pipelines when user confirms inline discard prompt", async () => {
    renderDetailPage("pipe-1");
    await makeDirty();

    fireEvent.click(screen.getByLabelText("Cancel changes"));
    // Inline confirm appears; clicking "Discard" navigates.
    fireEvent.click(screen.getByLabelText("Discard changes"));

    await waitFor(() => {
      expect(screen.getByText("Pipelines List")).toBeInTheDocument();
    });
  });

  it("stays on page when user dismisses inline discard prompt", async () => {
    renderDetailPage("pipe-1");
    await makeDirty();

    fireEvent.click(screen.getByLabelText("Cancel changes"));
    expect(
      screen.getByRole("alertdialog", { name: "Discard unsaved changes" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Keep editing"));

    expect(screen.queryByText("Pipelines List")).not.toBeInTheDocument();
    // Cancel button restored after dismissing the confirm.
    expect(screen.getByLabelText("Cancel changes")).toBeInTheDocument();
  });
});

// ── Select step config round-trip ─────────────────────────────────────────────

describe("PipelineDetailPage select step config round-trip", () => {
  const persistedSelectStep: PipelineStep = {
    id: "step-uuid-1",
    pipelineId: "pipe-1",
    position: 0,
    type: "select",
    config: { fields: ["id", "name"] },
    createdAt: "",
    updatedAt: "",
  };

  beforeEach(() => {
    fetchRunHistoryMock.mockResolvedValue([]);
    getPipelineByIdMock.mockResolvedValue(defaultPipeline);
    updatePipelineMock.mockResolvedValue(defaultPipeline);
    createPipelineStepMock.mockResolvedValue({
      id: "step-uuid-new",
      pipelineId: "pipe-1",
      position: 0,
      type: "select",
      config: { fields: [] },
      createdAt: "",
      updatedAt: "",
    });
    // Analyze response provides inputSchema for the step so SelectFieldsConfig
    // renders the correct checklist without needing a run-result.
    analyzePipelineMock.mockResolvedValue({
      id: "pipe-1",
      name: "Test Pipeline",
      sourceDataSourceName: "Test Source",
      outputDataTypeName: "TestType",
      outputDataTypeId: "dt-1",
      sourceSchema: [
        { name: "id", type: "string" },
        { name: "name", type: "string" },
        { name: "value", type: "string" },
      ],
      steps: [
        {
          id: "step-uuid-1",
          position: 0,
          type: "select",
          config: { fields: ["id", "name"] },
          inputSchema: [
            { name: "id", type: "string" },
            { name: "name", type: "string" },
            { name: "value", type: "string" },
          ],
          outputSchema: [
            { name: "id", type: "string" },
            { name: "name", type: "string" },
          ],
          validationError: undefined,
        },
      ],
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("restores previously selected fields when a persisted select step is expanded", async () => {
    getPipelineStepsMock.mockResolvedValue([persistedSelectStep]);
    const store = makeStore([], {});
    renderDetailPage("pipe-1", store);

    // Wait for the persisted step to be loaded and rendered
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Select fields/i })).toBeInTheDocument();
    });

    // Expand the step card
    fireEvent.click(screen.getByRole("button", { name: /Select fields/i, expanded: false }));

    // Previously saved fields should be checked; unsaved field should not be
    await waitFor(() => {
      expect(screen.getByLabelText("id")).toBeChecked();
      expect(screen.getByLabelText("name")).toBeChecked();
      expect(screen.getByLabelText("value")).not.toBeChecked();
    });
  });
});

// ── Rename step config round-trip ─────────────────────────────────────────────

describe("PipelineDetailPage rename step config", () => {
  const persistedRenameStep: PipelineStep = {
    id: "step-rename-1",
    pipelineId: "pipe-1",
    position: 0,
    type: "rename",
    config: { renames: { name: "full_name" } },
    createdAt: "",
    updatedAt: "",
  };

  const analyzeResponseWithRename: PipelineAnalyzeResponse = {
    id: "pipe-1",
    name: "Test Pipeline",
    sourceDataSourceName: "Test Source",
    outputDataTypeName: "TestType",
    outputDataTypeId: "dt-1",
    sourceSchema: [
      { name: "id", type: "string" },
      { name: "name", type: "string" },
      { name: "dept", type: "string" },
    ],
    steps: [
      {
        id: "step-rename-1",
        position: 0,
        type: "rename",
        config: { renames: { name: "full_name" } },
        inputSchema: [
          { name: "id", type: "string" },
          { name: "name", type: "string" },
          { name: "dept", type: "string" },
        ],
        outputSchema: [
          { name: "id", type: "string" },
          { name: "full_name", type: "string" },
          { name: "dept", type: "string" },
        ],
        validationError: undefined,
      },
    ],
  };

  beforeEach(() => {
    fetchRunHistoryMock.mockResolvedValue([]);
    getPipelineByIdMock.mockResolvedValue(defaultPipeline);
    updatePipelineMock.mockResolvedValue(defaultPipeline);
    createPipelineStepMock.mockResolvedValue({
      id: "step-uuid-new",
      pipelineId: "pipe-1",
      position: 0,
      type: "rename",
      config: { renames: {} },
      createdAt: "",
      updatedAt: "",
    });
    analyzePipelineMock.mockResolvedValue(analyzeResponseWithRename);
    updatePipelineStepMock.mockResolvedValue({
      id: "step-rename-1",
      pipelineId: "pipe-1",
      position: 0,
      type: "rename",
      config: { renames: { name: "full_name" } },
      createdAt: "",
      updatedAt: "",
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("rename step card shows field rows from the analyze inputSchema", async () => {
    getPipelineStepsMock.mockResolvedValue([persistedRenameStep]);
    renderDetailPage("pipe-1");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Rename column/i })).toBeInTheDocument();
    });

    // Expand the step card
    fireEvent.click(screen.getByRole("button", { name: /Rename column/i, expanded: false }));

    // Each field from the analyze inputSchema gets a text input
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "New name for id" })).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "New name for name" })).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "New name for dept" })).toBeInTheDocument();
    });
  });

  it("hydrates text inputs from the persisted step config on reload", async () => {
    getPipelineStepsMock.mockResolvedValue([persistedRenameStep]);
    renderDetailPage("pipe-1");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Rename column/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Rename column/i, expanded: false }));

    // "name" → "full_name" should be pre-filled; others empty
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "New name for name" })).toHaveValue("full_name");
      expect(screen.getByRole("textbox", { name: "New name for id" })).toHaveValue("");
      expect(screen.getByRole("textbox", { name: "New name for dept" })).toHaveValue("");
    });
  });

  it("text input change PATCHes config via updatePipelineStep", async () => {
    getPipelineStepsMock.mockResolvedValue([persistedRenameStep]);
    renderDetailPage("pipe-1");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Rename column/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Rename column/i, expanded: false }));

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "New name for dept" })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole("textbox", { name: "New name for dept" }), {
      target: { value: "department" },
    });

    await waitFor(() => {
      expect(updatePipelineStepMock).toHaveBeenCalledWith(
        "step-rename-1",
        expect.objectContaining({
          renames: expect.objectContaining({ dept: "department" }),
        }),
      );
    });
  });

  it("clearing a rename input removes the field key from the persisted config", async () => {
    getPipelineStepsMock.mockResolvedValue([persistedRenameStep]);
    renderDetailPage("pipe-1");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Rename column/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Rename column/i, expanded: false }));

    // Confirm the "name" input is pre-filled with "full_name"
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "New name for name" })).toHaveValue("full_name");
    });

    // Clear the input
    fireEvent.change(screen.getByRole("textbox", { name: "New name for name" }), {
      target: { value: "" },
    });

    // Config sent to the backend must NOT contain the "name" key
    await waitFor(() => {
      const lastCall =
        updatePipelineStepMock.mock.calls[updatePipelineStepMock.mock.calls.length - 1];
      expect(lastCall[0]).toBe("step-rename-1");
      const cfg = lastCall[1] as { renames: Record<string, string> };
      expect(cfg.renames).not.toHaveProperty("name");
    });
  });
});

// ── Task 4.8 — beforeunload registration and cleanup ─────────────────────────

describe("PipelineDetailPage beforeunload", () => {
  beforeEach(() => {
    fetchRunHistoryMock.mockResolvedValue([]);
    getPipelineByIdMock.mockResolvedValue(defaultPipeline);
    getPipelineStepsMock.mockResolvedValue([]);
    updatePipelineMock.mockResolvedValue(defaultPipeline);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("sets returnValue on beforeunload event when form is dirty", async () => {
    renderDetailPage("pipe-1");
    await act(async () => {});

    const editBtn = await screen.findByRole("button", { name: "Edit output name" });
    fireEvent.click(editBtn);
    const input = screen.getByRole("textbox", { name: "Output name" });
    fireEvent.change(input, { target: { value: "Dirty Value" } });
    fireEvent.blur(input);

    await waitFor(() => expect(screen.getByLabelText("Save pipeline")).toBeInTheDocument());

    const event = new Event("beforeunload") as BeforeUnloadEvent;
    Object.defineProperty(event, "returnValue", { writable: true, value: "" });
    act(() => {
      window.dispatchEvent(event);
    });

    expect(event.returnValue).toBe("");
  });

  it("does not set returnValue on beforeunload when form is clean", async () => {
    renderDetailPage("pipe-1");
    await act(async () => {});

    const event = new Event("beforeunload") as BeforeUnloadEvent;
    Object.defineProperty(event, "returnValue", { writable: true, value: "original" });
    act(() => {
      window.dispatchEvent(event);
    });

    // returnValue should not be changed since the form is clean
    expect(event.returnValue).toBe("original");
  });
});

// ── HEL-196: Run button disabled state and dispatch sequence ─────────────────

describe("PipelineDetailPage Run button (HEL-196)", () => {
  beforeEach(() => {
    runPipelineMock.mockResolvedValue({
      rowCount: 0,
      rows: [],
      stepRowCounts: {},
      sourceRowCount: 0,
    });
    fetchRunHistoryMock.mockResolvedValue([]);
    getPipelineByIdMock.mockResolvedValue(defaultPipeline);
    getPipelineStepsMock.mockResolvedValue([]);
    analyzePipelineMock.mockResolvedValue(emptyAnalyzeResponse);
    updatePipelineMock.mockResolvedValue(defaultPipeline);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // 2.3 — Run button disabled/enabled based on runStatus
  it("Run button is disabled when runStatus is queued", () => {
    const store = makeStore([], { runStatus: "queued", runId: "run-1" });
    renderDetailPage("pipe-1", store);
    expect(screen.getByRole("button", { name: "Run pipeline" })).toBeDisabled();
  });

  it("Run button is enabled when runStatus is null", () => {
    renderDetailPage("pipe-1");
    expect(screen.getByRole("button", { name: "Run pipeline" })).toBeEnabled();
  });

  // 2.4 — Clicking Run dispatches submitPipelineRun then fetchPipelineRunHistory
  it("clicking Run dispatches submitPipelineRun and then fetchPipelineRunHistory", async () => {
    renderDetailPage("pipe-1");

    // Wait for the on-mount fetchPipelineRunHistory dispatch to settle
    await waitFor(() => {
      expect(fetchRunHistoryMock).toHaveBeenCalledWith("pipe-1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Run pipeline" }));

    await waitFor(() => {
      expect(runPipelineMock).toHaveBeenCalledWith("pipe-1", undefined);
    });

    // fetchPipelineRunHistory should be called again after the run succeeds
    await waitFor(() => {
      expect(fetchRunHistoryMock).toHaveBeenCalledTimes(2);
    });
  });
});

// ── Step preview tests ────────────────────────────────────────────────────────

const persistedPreviewStep: PipelineStep = {
  id: "step-preview-1",
  pipelineId: "pipe-1",
  position: 0,
  type: "select",
  config: { fields: ["name", "score"] },
  createdAt: "",
  updatedAt: "",
};

describe("PipelineDetailPage step preview", () => {
  beforeEach(() => {
    fetchRunHistoryMock.mockResolvedValue([]);
    getPipelineByIdMock.mockResolvedValue(defaultPipeline);
    getPipelineStepsMock.mockResolvedValue([persistedPreviewStep]);
    analyzePipelineMock.mockResolvedValue(emptyAnalyzeResponse);
    updatePipelineMock.mockResolvedValue(defaultPipeline);
    updatePipelineStepMock.mockResolvedValue(persistedPreviewStep);
    createPipelineStepMock.mockResolvedValue(persistedPreviewStep);
    fetchStepPreviewMock.mockResolvedValue({
      rows: [
        { name: "alice", score: 42 },
        { name: "bob", score: 37 },
      ],
      rowCount: 2,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('"Preview data" button triggers fetchStepPreview and renders table on success', async () => {
    renderDetailPage("pipe-1");

    // Wait for the persisted step to appear
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Select fields/i })).toBeInTheDocument();
    });

    // Expand the step card
    fireEvent.click(screen.getByRole("button", { name: /Select fields/i, expanded: false }));

    // Click the Preview data button
    const previewBtn = await screen.findByRole("button", { name: "Preview data" });
    await act(async () => {
      fireEvent.click(previewBtn);
    });

    // fetchStepPreview should have been called
    await waitFor(() => {
      expect(fetchStepPreviewMock).toHaveBeenCalledWith("pipe-1", "step-preview-1");
    });

    // Preview table should render with column headers from the first row
    await waitFor(() => {
      expect(screen.getByRole("columnheader", { name: "name" })).toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: "score" })).toBeInTheDocument();
      expect(screen.getByText("alice")).toBeInTheDocument();
      expect(screen.getByText("bob")).toBeInTheDocument();
    });
  });

  it("shows loading state while preview request is in flight", async () => {
    // Never resolves so we can assert the loading indicator
    fetchStepPreviewMock.mockReturnValue(new Promise<never>(() => {}));

    renderDetailPage("pipe-1");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Select fields/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Select fields/i, expanded: false }));

    const previewBtn = await screen.findByRole("button", { name: "Preview data" });
    fireEvent.click(previewBtn);

    await waitFor(() => {
      expect(screen.getByText("Loading preview…")).toBeInTheDocument();
    });
  });

  it("renders error message when preview request fails", async () => {
    fetchStepPreviewMock.mockRejectedValue(new Error("Network error"));

    renderDetailPage("pipe-1");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Select fields/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Select fields/i, expanded: false }));

    const previewBtn = await screen.findByRole("button", { name: "Preview data" });
    await act(async () => {
      fireEvent.click(previewBtn);
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });
  });

  it("second click on Preview button hides the table", async () => {
    renderDetailPage("pipe-1");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Select fields/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Select fields/i, expanded: false }));

    const previewBtn = await screen.findByRole("button", { name: "Preview data" });
    await act(async () => {
      fireEvent.click(previewBtn);
    });

    // Table should be visible
    await waitFor(() => {
      expect(screen.getByText("alice")).toBeInTheDocument();
    });

    // Click again to hide
    const hideBtn = screen.getByRole("button", { name: "Hide preview" });
    fireEvent.click(hideBtn);

    await waitFor(() => {
      expect(screen.queryByText("alice")).not.toBeInTheDocument();
    });
  });
});

// ── HEL-197: Dry-run button and badge ────────────────────────────────────────

describe("PipelineDetailPage dry-run (HEL-197)", () => {
  beforeEach(() => {
    runPipelineMock.mockResolvedValue({
      rowCount: 0,
      rows: [],
      stepRowCounts: {},
      sourceRowCount: 0,
    });
    fetchRunHistoryMock.mockResolvedValue([]);
    getPipelineByIdMock.mockResolvedValue(defaultPipeline);
    getPipelineStepsMock.mockResolvedValue([]);
    analyzePipelineMock.mockResolvedValue(emptyAnalyzeResponse);
    updatePipelineMock.mockResolvedValue(defaultPipeline);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("renders a 'Dry run' button in the footer", () => {
    renderDetailPage("pipe-1");
    expect(screen.getByRole("button", { name: "Dry run" })).toBeInTheDocument();
  });

  it("clicking Dry run dispatches submitPipelineRun with ?dry=true", async () => {
    renderDetailPage("pipe-1");

    fireEvent.click(screen.getByRole("button", { name: "Dry run" }));

    await waitFor(() => {
      expect(runPipelineMock).toHaveBeenCalledWith("pipe-1", true);
    });
  });

  it("Dry run button is disabled when runStatus is queued", () => {
    const store = makeStore([], { runStatus: "queued", runId: "run-1" });
    renderDetailPage("pipe-1", store);
    expect(screen.getByRole("button", { name: "Dry run" })).toBeDisabled();
  });

  it("Dry run button is disabled when runStatus is running", () => {
    const store = makeStore([], { runStatus: "running", runId: "run-1" });
    renderDetailPage("pipe-1", store);
    expect(screen.getByRole("button", { name: "Dry run" })).toBeDisabled();
  });

  it("Dry run button is enabled when runStatus is null", () => {
    renderDetailPage("pipe-1");
    expect(screen.getByRole("button", { name: "Dry run" })).toBeEnabled();
  });

  it("run history shows 'Dry run' badge for status=dry_run", () => {
    const dryRun: PipelineRunRecord = {
      id: "run-dry-1",
      pipelineId: "pipe-1",
      status: "dry_run",
      startedAt: "2026-05-01T12:00:00Z",
      completedAt: "2026-05-01T12:00:01Z",
      rowCount: 5,
      errorLog: null,
    };
    const store = makeStore([], { runHistory: { "pipe-1": [dryRun] } });
    renderDetailPage("pipe-1", store);
    fireEvent.click(screen.getByRole("button", { name: /Open run history/i }));
    const badge = document.querySelector(".run-history-modal__status--dry_run");
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe("Dry run");
  });
});

// ── HEL-198: Success toast wording ───────────────────────────────────────────

describe("PipelineDetailPage run success message (HEL-198)", () => {
  beforeEach(() => {
    runPipelineMock.mockResolvedValue({
      rowCount: 3,
      rows: [{}, {}, {}],
      stepRowCounts: {},
      sourceRowCount: 0,
    });
    fetchRunHistoryMock.mockResolvedValue([]);
    getPipelineByIdMock.mockResolvedValue(defaultPipeline);
    getPipelineStepsMock.mockResolvedValue([]);
    analyzePipelineMock.mockResolvedValue(emptyAnalyzeResponse);
    updatePipelineMock.mockResolvedValue(defaultPipeline);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("shows 'Snapshot replaced: N rows' for a successful non-dry run", () => {
    const store = makeStore([], {
      runStatus: "succeeded",
      runIsDry: false,
      runResult: [{}, {}, {}],
    });
    renderDetailPage("pipe-1", store);
    expect(screen.getByLabelText("Run status: succeeded")).toHaveTextContent(
      "Snapshot replaced: 3 rows",
    );
  });

  it("shows 'Preview: N rows' for a successful dry run", () => {
    const store = makeStore([], {
      runStatus: "succeeded",
      runIsDry: true,
      runResult: [{}, {}],
    });
    renderDetailPage("pipe-1", store);
    expect(screen.getByLabelText("Run status: succeeded")).toHaveTextContent("Preview: 2 rows");
  });

  it("shows 'Snapshot replaced: 0 rows' when non-dry run produces no rows", () => {
    const store = makeStore([], {
      runStatus: "succeeded",
      runIsDry: false,
      runResult: [],
    });
    renderDetailPage("pipe-1", store);
    expect(screen.getByLabelText("Run status: succeeded")).toHaveTextContent(
      "Snapshot replaced: 0 rows",
    );
  });

  it("clicking Run dispatches submitPipelineRun without dryRun flag", async () => {
    renderDetailPage("pipe-1");
    fireEvent.click(screen.getByRole("button", { name: "Run pipeline" }));
    await waitFor(() => {
      expect(runPipelineMock).toHaveBeenCalledWith("pipe-1", undefined);
    });
  });

  it("clicking Dry run dispatches submitPipelineRun with dryRun=true", async () => {
    renderDetailPage("pipe-1");
    fireEvent.click(screen.getByRole("button", { name: "Dry run" }));
    await waitFor(() => {
      expect(runPipelineMock).toHaveBeenCalledWith("pipe-1", true);
    });
  });
});

// ---- HEL-199: StatusBadge running/queued visual states (task 3.8) ----------

describe("PipelineDetailPage StatusBadge running and queued states (HEL-199)", () => {
  beforeEach(() => {
    runPipelineMock.mockResolvedValue({
      rowCount: 0,
      rows: [],
      stepRowCounts: {},
      sourceRowCount: 0,
    });
    fetchRunHistoryMock.mockResolvedValue([]);
    getPipelineByIdMock.mockResolvedValue(defaultPipeline);
    getPipelineStepsMock.mockResolvedValue([]);
    analyzePipelineMock.mockResolvedValue(emptyAnalyzeResponse);
    updatePipelineMock.mockResolvedValue(defaultPipeline);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // 3.8a — spinner class applied for running status
  it("footer status badge has --running class when runStatus is running", () => {
    const store = makeStore([], { runStatus: "running", runId: "run-spin" });
    renderDetailPage("pipe-1", store);
    const badge = screen.getByLabelText("Run status: running");
    expect(badge).toHaveClass("pipeline-detail-page__run-status--running");
  });

  // 3.8b — pulse class applied for queued status
  it("footer status badge has --queued class when runStatus is queued", () => {
    const store = makeStore([], { runStatus: "queued", runId: "run-pulse" });
    renderDetailPage("pipe-1", store);
    const badge = screen.getByLabelText("Run status: queued");
    expect(badge).toHaveClass("pipeline-detail-page__run-status--queued");
  });

  // 3.8c — history modal status badge uses --running class
  it("history modal status badge renders with --running class for running status", () => {
    const run = {
      id: "run-hist-1",
      pipelineId: "pipe-1",
      status: "running" as const,
      startedAt: "2026-05-01T10:00:00Z",
      completedAt: null,
      rowCount: null,
      errorLog: null,
    };
    const store = makeStore([], { runHistory: { "pipe-1": [run] } });
    renderDetailPage("pipe-1", store);
    fireEvent.click(screen.getByRole("button", { name: /Open run history/i }));
    const badge = document.querySelector(".run-history-modal__status--running");
    expect(badge).not.toBeNull();
  });

  // 3.8d — history modal status badge uses --queued class
  it("history modal status badge renders with --queued class for queued status", () => {
    const run = {
      id: "run-hist-2",
      pipelineId: "pipe-1",
      status: "queued" as const,
      startedAt: "2026-05-01T10:00:00Z",
      completedAt: null,
      rowCount: null,
      errorLog: null,
    };
    const store = makeStore([], { runHistory: { "pipe-1": [run] } });
    renderDetailPage("pipe-1", store);
    fireEvent.click(screen.getByRole("button", { name: /Open run history/i }));
    const badge = document.querySelector(".run-history-modal__status--queued");
    expect(badge).not.toBeNull();
  });
});
