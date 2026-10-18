// HEL-1294 — a step whose optimistic create is in flight must not be editable: the swap of the temp id for the
// persisted one would drop an edit made on the temp id (a no-op). On the phone (HEL-1582) a created step opens
// in the step sheet straight away, so the contract is: the sheet's editor is DISABLED while the create is held,
// and when the create lands the SAME sheet stays open on the confirmed step with an enabled editor. The create
// request itself is held on a deferred promise so the in-flight window is deterministic.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
import { outputsReducer } from "../state/outputsSlice";
import { OverlayProvider } from "../../../shared/chrome/OverlayProvider";
import { PipelineDetailPage } from "./PipelineDetailPage";
import { installPhoneShell, settled } from "./pipelineDetailPageTestUtils";
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
      sourceSamples: sourceSamplesReducer,
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

/** `renderPage`, then lets the mount's own steps fetch settle. */
const renderPageSettled = (store = makeStore()) => settled(renderPage(store));

/** HEL-1345 — the create-immediately paths no longer issue a post-create steps GET (they apply the
 *  create response's delta), so the in-flight window is the CREATE request itself: hold it on a
 *  deferred promise and release it with the persisted step. */
function holdCreate() {
  let release: (step: PipelineStep) => void = () => {};
  createPipelineStepMock.mockReturnValueOnce(
    new Promise<PipelineStep>((resolve) => {
      release = resolve;
    }),
  );
  return { release: (step: PipelineStep) => act(async () => release(step)) };
}

async function addFilterStep() {
  fireEvent.click(screen.getByRole("button", { name: "+ Add step" }));
  fireEvent.click(await screen.findByRole("option", { name: /Filter rows/i }));
}

/** The phone step sheet (a created step opens in it). */
const stepSheet = () => screen.getByRole("dialog", { name: "Step editor" });

// The page logic under test is layout-independent; this file runs it through the phone layout (HEL-1582). jsdom has
// no `matchMedia`, so stub the phone shell.
let restorePhoneShell: () => void = () => {};
beforeEach(() => {
  restorePhoneShell = installPhoneShell();
});
afterEach(() => {
  restorePhoneShell();
});

describe("PipelineDetailPage — a step is not editable while its create is in flight (HEL-1294)", () => {
  beforeAll(() => {
    // jsdom doesn't implement HTMLDialogElement.showModal (the step palette and the step sheet are dialogs).
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

  it("disables the sheet's editor until the create lands, keeps the same sheet open, then edits PATCH the real id", async () => {
    getPipelineStepsMock.mockResolvedValue([]);
    const create = holdCreate();
    await renderPageSettled();

    fireEvent.click(screen.getByRole("button", { name: "+ Add step" }));
    fireEvent.click(await screen.findByRole("option", { name: /Rename column/i }));
    await waitFor(() => expect(createPipelineStepMock).toHaveBeenCalledTimes(1));

    // In flight: the create request is held. The new step is open in the sheet, saying so, and not editable.
    const sheet = stepSheet();
    expect(sheet).toHaveAttribute("open");
    expect(within(sheet).getByText("Saving step…")).toBeInTheDocument();
    expect(sheet.querySelector("fieldset")).toBeDisabled();

    await create.release(persisted("real-1", "rename", 0));

    // Settled: the SAME sheet stays open on the confirmed step (no close and reopen), its editor enabled; an
    // edit PATCHes the real id.
    const field = await within(stepSheet()).findByRole("textbox", { name: "New name for dept" });
    await waitFor(() => expect(field).toBeEnabled());
    expect(stepSheet()).toBe(sheet);
    expect(sheet).toHaveAttribute("open");
    expect(within(sheet).queryByText("Saving step…")).not.toBeInTheDocument();
    fireEvent.change(field, { target: { value: "department" } });
    await waitFor(() =>
      expect(updatePipelineStepMock).toHaveBeenCalledWith(
        "real-1",
        expect.objectContaining({ renames: expect.objectContaining({ dept: "department" }) }),
      ),
    );
  });

  it("a failed create keeps the sheet on the local step, shows the error inside it and re-enables the editor", async () => {
    getPipelineStepsMock.mockResolvedValue([]);
    let rejectCreate: (err: Error) => void = () => {};
    createPipelineStepMock.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectCreate = reject;
      }),
    );
    await renderPageSettled();

    await addFilterStep();
    const sheet = stepSheet();
    expect(within(sheet).getByText("Saving step…")).toBeInTheDocument();
    expect(sheet.querySelector("fieldset")).toBeDisabled();

    await act(async () => rejectCreate(new Error("Request failed with status code 500")));

    // The sheet is a modal dialog that covers the toast viewport, so the failure is shown inside it.
    expect(stepSheet()).toBe(sheet);
    expect(await within(sheet).findByText("Failed to add step.")).toBeVisible();
    expect(within(sheet).queryByText("Saving step…")).not.toBeInTheDocument();
    expect(sheet.querySelector("fieldset")).toBeEnabled();
    expect(within(sheet).getByRole("button", { name: "Remove step" })).toBeInTheDocument();
  });

  it("an AI draft (no create request) opens editable in the sheet", async () => {
    getPipelineStepsMock.mockResolvedValue([]);
    await renderPageSettled();

    fireEvent.click(screen.getByRole("button", { name: "+ Add step" }));
    fireEvent.click(await screen.findByRole("option", { name: /Analyze with AI/i }));

    const sheet = stepSheet();
    expect(createPipelineStepMock).not.toHaveBeenCalled();
    expect(sheet).toHaveAttribute("open");
    expect(within(sheet).getByText(/draft.*not yet saved/i)).toBeInTheDocument();
    expect(sheet.querySelector("fieldset")).toBeEnabled();
  });

  it("a lane-add step is not editable while its create is in flight, and its sheet stays open when it lands", async () => {
    getPipelineStepsMock.mockResolvedValue([persisted("anchor-1", "rename", 0)]);
    const create = holdCreate();
    await renderPageSettled();

    // Open the anchor's sheet, then branch from it through its Step actions menu.
    fireEvent.click(await screen.findByRole("button", { name: /^Step 1:/ }));
    fireEvent.click(within(stepSheet()).getByRole("button", { name: /Step actions for/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Branch from here" }));
    fireEvent.click(await screen.findByRole("option", { name: /Filter rows/i }));
    await waitFor(() => expect(createPipelineStepMock).toHaveBeenCalledTimes(1));

    // The sheet moved to the new lane step, whose editor is disabled while the create is held.
    const sheet = stepSheet();
    expect(within(sheet).getByText("Saving step…")).toBeInTheDocument();
    expect(sheet.querySelector("fieldset")).toBeDisabled();

    await create.release(persisted("real-1", "filter", 1));
    await waitFor(() => expect(sheet.querySelector("fieldset")).toBeEnabled());
    expect(stepSheet()).toBe(sheet);
    expect(within(sheet).queryByText("Saving step…")).not.toBeInTheDocument();
  });
});
