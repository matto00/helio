// HEL-1321 — an AI draft step is created when its config first becomes complete. The create
// resolving swaps the temp id for the server id in place; the card must NOT remount collapsed
// (its React key is stable across the swap), and an edit made while the POST was in flight must
// reach the server. The create POST is held on a deferred promise so the window is deterministic
// (the draft path issues no post-create steps GET, unlike HEL-1294's create-immediately paths).
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AxiosError } from "axios";
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
  chooseStepAction,
  stepRow,
  stepRows,
  stepSheet,
  stubDialogMethods,
} from "./pipelineMobileTestKit";
import {
  analyzePipeline,
  createPipelineStep,
  duplicatePipelineStep,
  fetchRunHistory,
  getPipelineById,
  getPipelineSchedule,
  getPipelineStepCatalog,
  getPipelineSteps,
  reorderPipelineSteps,
  updatePipelineStep,
  updatePipelineStepEnabled,
} from "../services/pipelineService";
import type { PipelineStepCatalog } from "../types/pipelineStepCatalog";
import type { PipelineAnalyzeResponse, PipelineStep, PipelineSummary } from "../types/pipelineStep";

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
      kind: "generatetext",
      label: "Generate text",
      description: "Generate text with AI.",
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
  callerRole: "owner",
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

function aiPersisted(
  id: string,
  position: number,
  parentStepId: string | null = null,
): PipelineStep {
  return {
    id,
    pipelineId: "pipe-1",
    position,
    type: "generatetext",
    parentStepId,
    config: { inputField: "notes", instruction: "Summarize", outputField: "summary" },
    createdAt: "",
    updatedAt: "",
  } as PipelineStep;
}

const notesSchema = [{ name: "notes", type: "string" }];

function deferredCreate() {
  let resolve: (s: PipelineStep) => void = () => {};
  let reject: (e: Error) => void = () => {};
  createPipelineStepMock.mockReturnValueOnce(
    new Promise<PipelineStep>((res, rej) => {
      resolve = res;
      reject = rej;
    }),
  );
  return {
    resolve: (s: PipelineStep) => act(async () => resolve(s)),
    reject: (e: Error) => act(async () => reject(e)),
  };
}

function chooseSelectOption(comboboxName: RegExp, optionLabel: string) {
  fireEvent.click(within(stepSheet()).getByRole("combobox", { name: comboboxName }));
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

// The AI draft opens in the phone's step sheet as soon as it is added (HEL-1582), so every query for its editor
// is scoped to that sheet.
const instructionBox = () =>
  within(stepSheet()).getByRole("textbox", { name: /instruction for the model/i });
/** The open sheet's focused editor for the Generate-text step. */
const generateEditor = () => within(stepSheet()).getByLabelText(/^Step \d+ Generate text$/);
const draftMarkerInSheet = () => within(stepSheet()).queryByText(/draft.*not yet saved/i);

/** Completes the open Generate-text draft's config (create fires). */
async function completeDraft(field = "notes") {
  chooseSelectOption(/input field to generate from/i, field);
  fireEvent.change(instructionBox(), { target: { value: "Summarize" } });
  fireEvent.change(within(stepSheet()).getByRole("textbox", { name: /destination field/i }), {
    target: { value: "summary" },
  });
  await waitFor(() => expect(createPipelineStepMock).toHaveBeenCalledTimes(1));
}

async function addTrunkDraft() {
  fireEvent.click(screen.getByRole("button", { name: "+ Add step" }));
  fireEvent.click(await screen.findByRole("option", { name: /Generate text/i }));
}

/** Opens the `anchorIndex`-th step's sheet and branches a Generate-text lane draft from it. */
async function addLaneDraft(anchorIndex = 0) {
  await waitFor(() => expect(stepRows().length).toBeGreaterThan(anchorIndex));
  fireEvent.click(stepRows()[anchorIndex]);
  chooseStepAction("Branch from here");
  fireEvent.click(await screen.findByRole("option", { name: /Generate text/i }));
}

// The page logic under test is layout-independent; this file runs it through the phone layout (HEL-1582). jsdom has
// no `matchMedia`, so stub the phone shell.
let restorePhoneShell: () => void = () => {};
beforeEach(() => {
  restorePhoneShell = installPhoneShell();
});
afterEach(() => {
  restorePhoneShell();
});

describe("PipelineDetailPage — an AI draft's card survives its own create (HEL-1321)", () => {
  beforeAll(() => {
    stubDialogMethods();
  });

  beforeEach(() => {
    jest.mocked(fetchRunHistory).mockResolvedValue([]);
    jest.mocked(getPipelineById).mockResolvedValue(pipeline);
    jest.mocked(getPipelineSchedule).mockRejectedValue({
      isAxiosError: true,
      response: { status: 404, data: undefined },
    });
    jest.mocked(getPipelineStepCatalog).mockResolvedValue(catalog);
    analyzePipelineMock.mockResolvedValue({
      ...analyzeResponse,
      sourceSchemas: [{ rootId: "root-1", sourceSchema: notesSchema }],
      steps: [
        {
          id: "anchor-1",
          position: 0,
          type: "rename" as const,
          config: { renames: {} },
          inputSchema: notesSchema,
          outputSchema: notesSchema,
        },
      ],
    });
    getPipelineStepsMock.mockResolvedValue([]);
    updatePipelineStepMock.mockResolvedValue(aiPersisted("ai-1", 0));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("keeps the open trunk draft's sheet open when its create resolves", async () => {
    const create = deferredCreate();
    await renderPageSettled();
    await addTrunkDraft();
    await completeDraft();
    const sheet = stepSheet();
    const editor = generateEditor();

    await create.resolve(aiPersisted("ai-1", 0));

    await waitFor(() => expect(draftMarkerInSheet()).not.toBeInTheDocument());
    // The same sheet, and the same editor node (an AI draft's render key survives the id swap).
    expect(stepSheet()).toBe(sheet);
    expect(sheet).toHaveAttribute("open");
    expect(generateEditor()).toBe(editor);
    expect(instructionBox()).toBeInTheDocument();
  });

  it("keeps a lane-add draft on a childless anchor open in its sheet and as its own lane head", async () => {
    getPipelineStepsMock.mockResolvedValue([persisted("anchor-1", "rename", 0)]);
    const create = deferredCreate();
    await renderPageSettled();
    await addLaneDraft();
    const laneOf = () => stepRow(/Generate text/i).closest(".spine-lane--sub");
    const laneBefore = laneOf();
    expect(laneBefore).not.toBeNull();
    await completeDraft();

    await create.resolve(aiPersisted("ai-1", 1, "anchor-1"));

    await waitFor(() => expect(draftMarkerInSheet()).not.toBeInTheDocument());
    expect(stepSheet()).toHaveAttribute("open");
    expect(instructionBox()).toBeInTheDocument();
    expect(laneOf()).toBe(laneBefore);
  });

  it("saves an edit made while the create was in flight to the persisted step", async () => {
    const create = deferredCreate();
    await renderPageSettled();
    await addTrunkDraft();
    await completeDraft();

    fireEvent.change(instructionBox(), { target: { value: "Summarize briefly" } });
    await create.resolve(aiPersisted("ai-1", 0));

    await waitFor(() =>
      expect(updatePipelineStepMock).toHaveBeenCalledWith(
        "ai-1",
        expect.objectContaining({ instruction: "Summarize briefly" }),
      ),
    );
    expect(instructionBox()).toHaveValue("Summarize briefly");
  });

  it("does not issue a flush PATCH when nothing was edited in flight", async () => {
    const create = deferredCreate();
    await renderPageSettled();
    await addTrunkDraft();
    await completeDraft();
    await create.resolve(aiPersisted("ai-1", 0));
    await waitFor(() => expect(draftMarkerInSheet()).not.toBeInTheDocument());
    expect(updatePipelineStepMock).not.toHaveBeenCalled();
  });

  it("an edit after the swap PATCHes the persisted id, with the card still open", async () => {
    const create = deferredCreate();
    await renderPageSettled();
    await addTrunkDraft();
    await completeDraft();
    await create.resolve(aiPersisted("ai-1", 0));
    await waitFor(() => expect(draftMarkerInSheet()).not.toBeInTheDocument());

    fireEvent.change(instructionBox(), { target: { value: "Summarize later" } });
    await waitFor(() =>
      expect(updatePipelineStepMock).toHaveBeenCalledWith(
        "ai-1",
        expect.objectContaining({ instruction: "Summarize later" }),
      ),
    );
    expect(createPipelineStepMock).toHaveBeenCalledTimes(1);
  });

  it("shows an inline error when saving the in-flight edit is rejected", async () => {
    updatePipelineStepMock.mockRejectedValue(
      new AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, undefined, {
        status: 422,
        data: { message: "instruction is too long" },
      } as never),
    );
    const create = deferredCreate();
    await renderPageSettled();
    await addTrunkDraft();
    await completeDraft();

    fireEvent.change(instructionBox(), { target: { value: "Summarize briefly" } });
    await create.resolve(aiPersisted("ai-1", 0));

    expect(await within(stepSheet()).findByText(/instruction is too long/)).toBeInTheDocument();
    expect(stepSheet()).toHaveAttribute("open");
  });

  it("a later full resync keeps the created draft, and the sheet follows the step it added", async () => {
    const create = deferredCreate();
    await renderPageSettled();
    await addTrunkDraft();
    await completeDraft();
    await create.resolve(aiPersisted("ai-1", 0));
    await waitFor(() => expect(draftMarkerInSheet()).not.toBeInTheDocument());

    // HEL-1345 D5 — a create-immediately add no longer resyncs (it applies the response delta), so
    // the full-list replace is triggered by a caller that still uses `syncStepsFromServer`:
    // duplicating the created draft's step. The `renderKey`-across-full-replace path stays
    // exercised.
    jest.mocked(duplicatePipelineStep).mockResolvedValue(aiPersisted("ai-2", 1));
    getPipelineStepsMock.mockResolvedValue([aiPersisted("ai-1", 0), aiPersisted("ai-2", 1)]);
    fireEvent.click(within(stepSheet()).getByRole("button", { name: "Duplicate step" }));
    await waitFor(() => expect(stepRows()).toHaveLength(2));
    await act(async () => {});

    // WHICH step: the created draft (ai-1) stays first and keeps its place; the step the duplicate added
    // (ai-2, second) opens in the one sheet, as a step added on the desktop is selected.
    expect(stepRows()[0]).toHaveAccessibleName(/^Step 1: Generate text/);
    expect(stepRows()[1]).toHaveAccessibleName(/^Step 2: Generate text/);
    expect(stepSheet()).toHaveAttribute("open");
    expect(within(stepSheet()).getByLabelText("Step 2 Generate text")).toBeInTheDocument();
    // Reopening the created draft shows its own, persisted editor (not lost by the full replace).
    fireEvent.click(stepRows()[0]);
    expect(within(stepSheet()).getByLabelText("Step 1 Generate text")).toBeInTheDocument();
    expect(instructionBox()).toHaveValue("Summarize");
  });

  it("an enable toggle on a created draft keeps its sheet open", async () => {
    jest.mocked(updatePipelineStepEnabled).mockResolvedValue({
      ...aiPersisted("ai-1", 0),
      enabled: false,
    });
    const create = deferredCreate();
    await renderPageSettled();
    await addTrunkDraft();
    await completeDraft();
    await create.resolve(aiPersisted("ai-1", 0));
    await waitFor(() => expect(draftMarkerInSheet()).not.toBeInTheDocument());

    const sheet = stepSheet();
    fireEvent.click(within(sheet).getByRole("button", { name: "Disable step" }));
    await waitFor(() => expect(updatePipelineStepEnabled).toHaveBeenCalledWith("ai-1", false));
    await within(sheet).findByRole("button", { name: "Enable step" });

    expect(stepSheet()).toBe(sheet);
    expect(sheet).toHaveAttribute("open");
  });

  it("a non-head reorder keeps a created draft's sheet open", async () => {
    // Server-realistic (HEL-1345): a gap insert after `anchor-1` splices directly after it, so
    // the created step sits between `anchor-1` and `f-1` and `f-1` hangs under it. Any later full
    // resync lists them in that order, and it must never make `ai-1` vanish.
    getPipelineStepsMock.mockResolvedValueOnce([
      persisted("anchor-1", "rename", 0),
      persisted("f-1", "filter", 1),
    ]);
    getPipelineStepsMock.mockResolvedValue([
      persisted("anchor-1", "rename", 0),
      aiPersisted("ai-1", 0, "anchor-1"),
      { ...persisted("f-1", "filter", 0), parentStepId: "ai-1" },
    ]);
    const create = deferredCreate();
    await renderPageSettled();
    await waitFor(() => expect(stepRows()).toHaveLength(2));
    // Insert after the anchor (the first of the two rows) from its sheet.
    fireEvent.click(stepRows()[0]);
    chooseStepAction("Insert step after");
    fireEvent.click(await screen.findByRole("option", { name: /Generate text/i }));
    await completeDraft();
    await create.resolve({
      ...aiPersisted("ai-1", 0, "anchor-1"),
      reparentedStepIds: ["f-1"],
    } as unknown as PipelineStep);
    await waitFor(() => expect(draftMarkerInSheet()).not.toBeInTheDocument());

    jest
      .mocked(reorderPipelineSteps)
      .mockResolvedValue([
        persisted("anchor-1", "rename", 0),
        aiPersisted("ai-1", 1),
        persisted("f-1", "filter", 2),
      ]);
    const sheet = stepSheet();
    chooseStepAction(/Move step up/i);
    await waitFor(() => expect(reorderPipelineSteps).toHaveBeenCalled());
    await act(async () => {});

    expect(stepSheet()).toBe(sheet);
    expect(sheet).toHaveAttribute("open");
    expect(generateEditor()).toBeInTheDocument();
  });

  // HEL-1340 item 3 — between the create being sent and the step's own analyze entry arriving, the
  // draft has neither an analyze entry nor pending meta; its field picker must still resolve.
  const inputFieldSelect = () =>
    within(stepSheet()).getByRole("combobox", { name: /input field to generate from/i });

  it("keeps the chosen input field shown while the draft's create is in flight", async () => {
    const create = deferredCreate();
    await renderPageSettled();
    await addTrunkDraft();
    await completeDraft();

    expect(inputFieldSelect()).toHaveTextContent("notes");

    await create.resolve(aiPersisted("ai-1", 0));
  });

  it("keeps the chosen input field shown after the create, before its own analyze lands", async () => {
    const create = deferredCreate();
    await renderPageSettled();
    await addTrunkDraft();
    await completeDraft();
    // Hold every later /analyze (the post-swap debounced one) unresolved.
    analyzePipelineMock.mockReturnValue(new Promise<PipelineAnalyzeResponse>(() => {}));
    const analyzeCallsBefore = analyzePipelineMock.mock.calls.length;
    await create.resolve(aiPersisted("ai-1", 0));
    await waitFor(() => expect(draftMarkerInSheet()).not.toBeInTheDocument());
    // Assert only once the post-swap /analyze has actually been issued (debounced) and is held.
    await waitFor(() =>
      expect(analyzePipelineMock.mock.calls.length).toBeGreaterThan(analyzeCallsBefore),
    );

    expect(inputFieldSelect()).toHaveTextContent("notes");
    // The fallback input has no matching output schema yet: no false "dropped" diff chips.
    expect(
      stepSheet().querySelector(".pipeline-detail-page__step-card-diff-chip--removed"),
    ).toBeNull();
  });

  it("a lane draft in flight resolves its field from its exact anchor, not a trunk neighbour", async () => {
    // Real root assignment and parent chain (root-1: p-0 -> anchor-1), so `buildLaneGraph` builds
    // a genuine child lane and the draft renders through `LaneColumn` inside the Lanes group.
    // Only p-0 has an analyze entry (output `notes`); the anchor has none and the root source
    // exposes only `other`. Exact-anchor resolution therefore falls to the root source (`other`);
    // a trunk array walk would wrongly land on p-0 (`notes`).
    getPipelineStepsMock.mockResolvedValue([
      { ...persisted("p-0", "rename", 0), rootId: "root-1" },
      { ...persisted("anchor-1", "rename", 0), rootId: "root-1", parentStepId: "p-0" },
    ]);
    analyzePipelineMock.mockResolvedValue({
      ...analyzeResponse,
      sourceSchemas: [{ rootId: "root-1", sourceSchema: [{ name: "other", type: "string" }] }],
      steps: [
        {
          id: "p-0",
          position: 0,
          type: "rename" as const,
          config: { renames: {} },
          inputSchema: notesSchema,
          outputSchema: notesSchema,
        },
      ],
    });
    const create = deferredCreate();
    await renderPageSettled();
    await waitFor(() => expect(stepRows()).toHaveLength(2));
    // Branch from the second (the anchor's own) step.
    await addLaneDraft(1);
    await completeDraft("other");
    const inLanesGroup = () => stepRow(/Generate text/i).closest(".spine-lane--sub") !== null;

    expect(inLanesGroup()).toBe(true);
    expect(inputFieldSelect()).toHaveTextContent("other");

    // Hold the post-swap /analyze and wait until it has actually been issued.
    analyzePipelineMock.mockReturnValue(new Promise<PipelineAnalyzeResponse>(() => {}));
    const analyzeCallsBefore = analyzePipelineMock.mock.calls.length;
    await create.resolve(aiPersisted("ai-1", 1, "anchor-1"));
    await waitFor(() => expect(draftMarkerInSheet()).not.toBeInTheDocument());
    await waitFor(() =>
      expect(analyzePipelineMock.mock.calls.length).toBeGreaterThan(analyzeCallsBefore),
    );

    expect(inLanesGroup()).toBe(true);
    expect(inputFieldSelect()).toHaveTextContent("other");
    expect(
      stepSheet().querySelector(".pipeline-detail-page__step-card-diff-chip--removed"),
    ).toBeNull();
  });
});
