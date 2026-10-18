// HEL-1506 -- applying a shape at the bottom of a pipeline whose last primary-lane step B has a
// lane L. The shape's creates are plain splices, so the server moves L under the shape's last step
// and reports it in each create response's `reparentedStepIds`. The editor must apply that delta
// right away (no reload). `createPipelineStep` is the REAL service function over a mocked
// `httpClient`, so the wire-JSON -> `reparentedStepIds` mapping is exercised, not bypassed.
import {
  configure,
  fireEvent,
  getConfig,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
import { httpClient } from "../../../services/httpClient";
import {
  analyzePipeline,
  expandPipelineShape,
  fetchRunHistory,
  getPipelineById,
  getPipelineSchedule,
  getPipelineShapeCatalog,
  getPipelineStepCatalog,
  getPipelineSteps,
} from "../services/pipelineService";
import { defaultConfigFor } from "../state/stepNarrowing";
import type { PipelineStepCatalog } from "../types/pipelineStepCatalog";
import type { PipelineAnalyzeResponse, PipelineStep, PipelineSummary } from "../types/pipelineStep";
import type { PipelineShapeCatalogEntry } from "../types/pipelineShape";
import { installPhoneShell } from "./pipelineDetailPageTestUtils";
import {
  chooseHeaderAction,
  chooseStepAction,
  closeStepSheet,
  findStepRow,
  laneParentLabel,
  openStepSheet,
  stepSheet,
  stubDialogMethods,
} from "./pipelineMobileTestKit";

jest.mock("../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

jest.mock("../services/pipelineService", () => ({
  // The one REAL function: the seam under test (wire JSON -> `reparentedStepIds`).
  createPipelineStep: jest.requireActual("../services/pipelineService").createPipelineStep,
  fetchPipelines: jest.fn(),
  runPipeline: jest.fn(),
  fetchRunHistory: jest.fn(),
  getPipelineById: jest.fn(),
  getPipelineSteps: jest.fn(),
  reorderPipelineSteps: jest.fn(),
  updatePipeline: jest.fn(),
  updatePipelineStep: jest.fn(),
  updatePipelineStepEnabled: jest.fn(),
  duplicatePipelineStep: jest.fn(),
  deletePipelineStep: jest.fn(),
  analyzePipeline: jest.fn(),
  fetchStepPreview: jest.fn(),
  getPipelineSchedule: jest.fn(),
  getPipelineStepCatalog: jest.fn(),
  getPipelineShapeCatalog: jest.fn(),
  expandPipelineShape: jest.fn(),
  listPipelinePermissions: jest.fn(),
}));

jest.mock("../services/outputService", () => ({
  ...jest.requireActual("../services/outputService"),
  listOutputs: async () => [],
}));

const postMock = jest.mocked(httpClient.post);

const catalog: PipelineStepCatalog = {
  groups: [{ id: "filter-shape", label: "Filter & shape" }],
  steps: [
    ["rename", "Rename column", "filter-shape"],
    ["filter", "Filter rows", "filter-shape"],
    ["cast", "Cast type", "filter-shape"],
    ["limit", "Limit rows", "filter-shape"],
    ["sort", "Sort rows", "filter-shape"],
    ["generatetext", "Generate text", "filter-shape"],
  ].map(([kind, label, group]) => ({
    kind,
    label,
    description: label,
    group,
    authorable: true,
  })) as PipelineStepCatalog["steps"],
};

const shapeEntry: PipelineShapeCatalogEntry = {
  id: "top-n",
  label: "Top N",
  description: "Top rows.",
  paramsSchema: [
    { name: "mode", label: "Mode", dataType: "string", required: true, description: "mode" },
  ],
  outputContract: { rowCount: { kind: "exactly-one" }, description: "" },
};

const pipeline: PipelineSummary = {
  id: "pipe-1",
  name: "Test Pipeline",
  roots: [{ id: "root-1", dataSourceId: "src-1", dataSourceName: "Test Source" }],
  lastRunStatus: null,
  lastRunAt: null,
  lastRunRowCount: null,
};

function ps(
  id: string,
  type: "rename" | "filter" | "cast" | "limit" | "sort",
  opts: { parent?: string; position?: number } = {},
): PipelineStep {
  return {
    id,
    pipelineId: "pipe-1",
    position: opts.position ?? 0,
    type,
    config: defaultConfigFor(type),
    parentStepId: opts.parent ?? null,
    rootId: opts.parent ? null : "root-1",
    createdAt: "",
    updatedAt: "",
    enabled: true,
  } as unknown as PipelineStep;
}

/** What the backend emits for a create: the step row plus the ids the splice re-parented. */
function wire(step: PipelineStep, reparentedStepIds: string[]) {
  return { data: { ...step, reparentedStepIds } };
}

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
  render(
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
  return store;
}

async function applyShape() {
  await screen.findByRole("button", { name: "Pipeline actions" });
  chooseHeaderAction("Add Outputs from a shape");
  fireEvent.click(await screen.findByText("Top N"));
  fireEvent.change(screen.getByRole("textbox", { name: "Mode" }), { target: { value: "x" } });
  fireEvent.click(screen.getByRole("button", { name: "Add steps" }));
}

// Server state before: A <- root, B <- A, L <- B (L is a lane: position 1).
const A = () => ps("A", "rename");
const B = () => ps("B", "filter", { parent: "A" });
const L = () => ps("L", "cast", { parent: "B", position: 1 });

jest.setTimeout(40000);

// The page logic under test is layout-independent; this file runs it through the phone layout (HEL-1582). jsdom has
// no `matchMedia`, so stub the phone shell.
let restorePhoneShell: () => void = () => {};
beforeEach(() => {
  restorePhoneShell = installPhoneShell();
});
afterEach(() => {
  restorePhoneShell();
});

describe("PipelineDetailPage - shape apply reflects reparented lanes (HEL-1506)", () => {
  const originalAsyncUtilTimeout = getConfig().asyncUtilTimeout;
  beforeAll(() => {
    configure({ asyncUtilTimeout: 20000 });
    stubDialogMethods();
  });
  afterAll(() => {
    configure({ asyncUtilTimeout: originalAsyncUtilTimeout });
  });

  beforeEach(() => {
    jest.mocked(fetchRunHistory).mockResolvedValue([]);
    jest.mocked(getPipelineById).mockResolvedValue(pipeline);
    jest.mocked(getPipelineSchedule).mockRejectedValue({
      isAxiosError: true,
      response: { status: 404, data: undefined },
    });
    jest.mocked(getPipelineStepCatalog).mockResolvedValue(catalog);
    jest.mocked(getPipelineShapeCatalog).mockResolvedValue([shapeEntry]);
    jest.mocked(analyzePipeline).mockResolvedValue({
      id: "pipe-1",
      name: "Test Pipeline",
      sourceSchemas: [{ rootId: "root-1", sourceSchema: [{ name: "notes", type: "string" }] }],
      steps: [],
      costVerdict: { autoRunnable: true, stepCount: 1, reasons: [], canRun: true },
      warnings: [],
    } as PipelineAnalyzeResponse);
    jest.mocked(getPipelineSteps).mockResolvedValue([A(), B(), L()]);
    jest.mocked(expandPipelineShape).mockResolvedValue({
      steps: [
        { clientId: "step-0", kind: "sort", config: defaultConfigFor("sort") },
        {
          clientId: "step-1",
          kind: "limit",
          config: defaultConfigFor("limit"),
          parentStepId: "step-0",
        },
      ],
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("moves the lane under the shape's last step immediately after apply (matches the server)", async () => {
    postMock
      .mockResolvedValueOnce(wire(ps("S1", "sort", { parent: "B" }), ["L"]))
      .mockResolvedValueOnce(wire(ps("S2", "limit", { parent: "S1" }), ["L"]));
    renderPage();
    // Before: L is a lane off B.
    await findStepRow(/Cast type/i);
    expect(laneParentLabel(/Cast type/i)).toBe("Filter rows");

    await applyShape();

    // Wire seam: both creates are plain splices (no attachAsTail) -- B, then the first shape step.
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(2));
    expect(
      postMock.mock.calls.map((c) => (c[1] as { parentStepId?: string }).parentStepId),
    ).toEqual(["B", "S1"]);
    // L is now a lane off the shape's LAST step (limit), not off B -- and the shape continues
    // the primary lane (sort, limit are not lane cards).
    await waitFor(() => expect(laneParentLabel(/Cast type/i)).toBe("Limit rows"));
    expect(laneParentLabel(/Sort rows/i)).toBeNull();
    expect(laneParentLabel(/Limit rows/i)).toBeNull();
    expect(jest.mocked(getPipelineSteps)).toHaveBeenCalledTimes(1);
  });

  it("applies the first create's reparent when the second create fails, and shows the partial toast", async () => {
    postMock
      .mockResolvedValueOnce(wire(ps("S1", "sort", { parent: "B" }), ["L"]))
      .mockRejectedValueOnce(new Error("Request failed with status code 500"));
    const store = renderPage();
    await findStepRow(/Cast type/i);

    await applyShape();

    // Server after the partial apply: B <- A, S1 <- B, L <- S1.
    await waitFor(() => expect(laneParentLabel(/Cast type/i)).toBe("Sort rows"));
    await waitFor(() => {
      const toasts = store.getState().toasts.items;
      expect(toasts).toHaveLength(1);
      expect(toasts[0].message).toMatch(/1 of 2 entries were added/i);
    });
  });

  it("keeps a local-only draft after a shape apply (no wholesale replace)", async () => {
    postMock
      .mockResolvedValueOnce(wire(ps("S1", "sort", { parent: "B" }), ["L"]))
      .mockResolvedValueOnce(wire(ps("S2", "limit", { parent: "S1" }), ["L"]));
    renderPage();
    await findStepRow(/Cast type/i);
    // A Generate-text draft between A and B stays local-only until its config is complete. It opens in the sheet.
    openStepSheet(/Rename column/i);
    chooseStepAction("Insert step after");
    fireEvent.click(await screen.findByRole("option", { name: /Generate text/i }));
    expect(within(stepSheet()).getAllByText(/draft.*not yet saved/i)).toHaveLength(1);
    await closeStepSheet();
    expect(screen.getAllByText(/draft.*not yet saved/i)).toHaveLength(1);

    await applyShape();

    await waitFor(() => expect(laneParentLabel(/Cast type/i)).toBe("Limit rows"));
    expect(screen.getAllByText(/draft.*not yet saved/i)).toHaveLength(1);
    expect(jest.mocked(getPipelineSteps)).toHaveBeenCalledTimes(1);
  });
});
