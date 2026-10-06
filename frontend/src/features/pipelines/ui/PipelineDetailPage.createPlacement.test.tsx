// HEL-1345 D5/D11 — step-create placement in the editor. A create applies the server-reported
// delta (`reparentedStepIds`) to local state instead of resyncing wholesale, so local-only drafts,
// open cards and render keys survive; a gap insert anchors on a persisted step id (`parentStepId`),
// never on an index. Every create here is held on a deferred promise so response ORDER is explicit.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  deletePipelineStep,
  duplicatePipelineStep,
  fetchRunHistory,
  getPipelineById,
  getPipelineSchedule,
  getPipelineStepCatalog,
  getPipelineSteps,
  updatePipelineStep,
} from "../services/pipelineService";
import { defaultConfigFor } from "../state/stepNarrowing";
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
const duplicatePipelineStepMock = jest.mocked(duplicatePipelineStep);
const deletePipelineStepMock = jest.mocked(deletePipelineStep);

const catalog: PipelineStepCatalog = {
  groups: [
    { id: "filter-shape", label: "Filter & shape" },
    { id: "ai", label: "AI" },
  ],
  steps: [
    ["rename", "Rename column", "filter-shape"],
    ["filter", "Filter rows", "filter-shape"],
    ["cast", "Cast type", "filter-shape"],
    ["limit", "Limit rows", "filter-shape"],
    ["sort", "Sort rows", "filter-shape"],
    ["generatetext", "Generate text", "ai"],
  ].map(([kind, label, group]) => ({
    kind,
    label,
    description: label,
    group,
    authorable: true,
  })) as PipelineStepCatalog["steps"],
};

const pipeline: PipelineSummary = {
  id: "pipe-1",
  name: "Test Pipeline",
  roots: [{ id: "root-1", dataSourceId: "src-1", dataSourceName: "Test Source" }],
  lastRunStatus: null,
  lastRunAt: null,
  lastRunRowCount: null,
};

const notesSchema = [{ name: "notes", type: "string" }];

/** A persisted step with real tree fields. A root-level step carries `rootId`; others a parent. */
function ps(
  id: string,
  type: "rename" | "filter" | "limit" | "cast" | "sort" | "generatetext",
  opts: { parent?: string; position?: number; rootId?: string } = {},
): PipelineStep {
  const config =
    type === "generatetext"
      ? { inputField: "notes", instruction: "Summarize", outputField: "summary" }
      : defaultConfigFor(type);
  return {
    id,
    pipelineId: "pipe-1",
    position: opts.position ?? 0,
    type,
    config,
    parentStepId: opts.parent ?? null,
    rootId: opts.parent ? null : (opts.rootId ?? "root-1"),
    createdAt: "",
    updatedAt: "",
    enabled: true,
  } as unknown as PipelineStep;
}

/** The server's create response: the created step plus the ids it re-parented. */
function createdResp(step: PipelineStep, reparentedStepIds: string[] = []): PipelineStep {
  return { ...step, reparentedStepIds } as unknown as PipelineStep;
}

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

type Deferred = {
  resolve: (s: PipelineStep) => Promise<void>;
  reject: (e: Error) => Promise<void>;
};

/** Queue the NEXT createPipelineStep call on a held promise. */
function deferredCreate(): Deferred {
  let resolve: (s: PipelineStep) => void = () => {};
  let reject: (e: Error) => void = () => {};
  createPipelineStepMock.mockReturnValueOnce(
    new Promise<PipelineStep>((res, rej) => {
      resolve = res;
      reject = rej;
    }),
  );
  return {
    resolve: (s) => act(async () => resolve(s)),
    reject: (e) => act(async () => reject(e)),
  };
}

const labelsInOrder = () =>
  Array.from(document.querySelectorAll(".pipeline-detail-page__step-card-label")).map(
    (el) => el.textContent ?? "",
  );

/** The label of the step whose lane `toggle`'s card sits in as a CHILD lane, or null when the card
 *  is on a root lane (i.e. its lane hangs off no parent card). */
function laneParentLabel(label: RegExp): string | null {
  const toggle = screen.getByRole("button", { name: label });
  const lanes = toggle.closest('[aria-label="Lanes"]');
  if (!lanes) return null;
  return (
    lanes.parentElement?.querySelector(".pipeline-detail-page__step-card-label")?.textContent ??
    null
  );
}

const gaps = () => screen.getAllByRole("button", { name: "Insert step here" });
const addBottom = () => screen.getByRole("button", { name: /\+ Add (transformation )?step/ });

async function insertAt(gapIndex: number, option: RegExp) {
  fireEvent.click(gaps()[gapIndex]);
  fireEvent.click(await screen.findByRole("option", { name: option }));
}
async function appendBottom(option: RegExp) {
  fireEvent.click(addBottom());
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

function chooseSelectOption(comboboxName: RegExp, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: comboboxName }));
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

/** Completes the open (first collapsed) Generate-text draft's config so its create fires. */
async function completeFirstDraft(expectedCalls: number) {
  fireEvent.click(
    (await screen.findAllByRole("button", { name: /Generate text/i, expanded: false }))[0],
  );
  chooseSelectOption(/input field to generate from/i, "notes");
  fireEvent.change(screen.getByRole("textbox", { name: /instruction for the model/i }), {
    target: { value: "Summarize" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: /destination field/i }), {
    target: { value: "summary" },
  });
  await waitFor(() => expect(createPipelineStepMock).toHaveBeenCalledTimes(expectedCalls));
}

const A = () => ps("A", "rename");
const B = () => ps("B", "filter", { parent: "A" });
const C = () => ps("C", "limit", { parent: "B" });

describe("PipelineDetailPage - step-create placement and the response delta (HEL-1345)", () => {
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
    jest.mocked(getPipelineStepCatalog).mockResolvedValue(catalog);
    analyzePipelineMock.mockResolvedValue({
      id: "pipe-1",
      name: "Test Pipeline",
      sourceSchemas: [{ rootId: "root-1", sourceSchema: notesSchema }],
      steps: [],
      costVerdict: { autoRunnable: true, stepCount: 1, reasons: [], canRun: true },
    } as PipelineAnalyzeResponse);
    getPipelineStepsMock.mockResolvedValue([A(), B(), C()]);
    updatePipelineStepMock.mockResolvedValue(ps("N", "generatetext"));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // (a)
  it("a draft inserted between A and B: B is re-parented under the created step without a reload, a second local draft survives, and the created card stays expanded with its in-flight edit", async () => {
    const create = deferredCreate();
    renderPage();
    await screen.findByRole("button", { name: /Limit rows/i });
    await insertAt(1, /Generate text/i);
    await completeFirstDraft(1);
    // D11: anchored on the persisted step before the gap, never on the index.
    expect(createPipelineStepMock).toHaveBeenLastCalledWith(
      "pipe-1",
      "generatetext",
      expect.anything(),
      undefined,
      "A",
      undefined,
      undefined,
    );
    // A second, never-completed local draft at the bottom.
    await appendBottom(/Generate text/i);
    // An edit made while the create is in flight.
    fireEvent.change(screen.getByRole("textbox", { name: /instruction for the model/i }), {
      target: { value: "Summarize briefly" },
    });

    await create.resolve(createdResp(ps("N", "generatetext", { parent: "A" }), ["B"]));

    await waitFor(() => expect(screen.getAllByText(/draft.*not yet saved/i)).toHaveLength(1));
    expect(labelsInOrder()).toEqual([
      "Rename column",
      "Generate text",
      "Filter rows",
      "Limit rows",
      "Generate text",
    ]);
    expect(screen.getAllByRole("button", { name: /Generate text/i, expanded: true })).toHaveLength(
      1,
    );
    expect(screen.getByRole("textbox", { name: /instruction for the model/i })).toHaveValue(
      "Summarize briefly",
    );
    expect(getPipelineStepsMock).toHaveBeenCalledTimes(1);
  }, 20000); // heaviest case: a draft insert, a second draft and an in-flight edit; ~1.9s under load

  // (b)
  it.each([
    [0, ["Cast type", "Rename column", "Filter rows", "Limit rows"], undefined, "A"],
    [1, ["Rename column", "Cast type", "Filter rows", "Limit rows"], "A", "B"],
  ])(
    "an immediate insert at gap %i yields exactly one card for the created step, keeps an open card open, and applies the reparent",
    async (gap, order, createdParent, reparented) => {
      const create = deferredCreate();
      renderPage();
      fireEvent.click(await screen.findByRole("button", { name: /Limit rows/i, expanded: false }));
      expect(screen.getByRole("button", { name: /Limit rows/i })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      await insertAt(gap, /Cast type/i);
      await waitFor(() => expect(createPipelineStepMock).toHaveBeenCalledTimes(1));

      await create.resolve(
        createdResp(createdParent ? ps("N", "cast", { parent: createdParent }) : ps("N", "cast"), [
          reparented,
        ]),
      );

      await waitFor(() => expect(screen.getByRole("button", { name: /Cast type/i })).toBeEnabled());
      expect(screen.getAllByRole("button", { name: /Cast type/i })).toHaveLength(1);
      expect(labelsInOrder()).toEqual(order);
      expect(screen.getByRole("button", { name: /Limit rows/i })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      expect(getPipelineStepsMock).toHaveBeenCalledTimes(1);
    },
  );

  // (c)
  it("two inserts at the same gap whose responses arrive in reverse commit order end with the server's A, Y, X, B", async () => {
    const createX = deferredCreate();
    renderPage();
    await screen.findByRole("button", { name: /Limit rows/i });
    await insertAt(1, /Cast type/i); // X
    const createY = deferredCreate();
    await insertAt(1, /Sort rows/i); // Y, same gap
    await waitFor(() => expect(createPipelineStepMock).toHaveBeenCalledTimes(2));
    // Both anchored on A.
    expect(createPipelineStepMock.mock.calls.map((c) => c[4])).toEqual(["A", "A"]);

    // Server commit order: X then Y => A -> Y -> X -> B. Y (second-committed) responds FIRST and
    // names X's persisted id as reparented; X's response then names B.
    await createY.resolve(createdResp(ps("Y", "sort", { parent: "A" }), ["X"]));
    await createX.resolve(createdResp(ps("X", "cast", { parent: "A" }), ["B"]));

    await waitFor(() =>
      expect(labelsInOrder()).toEqual([
        "Rename column",
        "Sort rows",
        "Cast type",
        "Filter rows",
        "Limit rows",
      ]),
    );
    expect(getPipelineStepsMock).toHaveBeenCalledTimes(1);
  });

  // (d)
  it.each([["X then Y"], ["Y then X"]])(
    "inserts at different gaps anchor on A and on B and end A, X, B, Y, C (%s)",
    async (arrival) => {
      const createX = deferredCreate();
      renderPage();
      await screen.findByRole("button", { name: /Limit rows/i });
      await insertAt(1, /Cast type/i); // X after A
      const createY = deferredCreate();
      await insertAt(2, /Sort rows/i); // Y after B (X still in flight)
      await waitFor(() => expect(createPipelineStepMock).toHaveBeenCalledTimes(2));
      expect(createPipelineStepMock.mock.calls.map((c) => c[4])).toEqual(["A", "B"]);

      const x = createdResp(ps("X", "cast", { parent: "A" }), ["B"]);
      const y = createdResp(ps("Y", "sort", { parent: "B" }), ["C"]);
      if (arrival === "X then Y") {
        await createX.resolve(x);
        await createY.resolve(y);
      } else {
        await createY.resolve(y);
        await createX.resolve(x);
      }

      await waitFor(() =>
        expect(labelsInOrder()).toEqual([
          "Rename column",
          "Cast type",
          "Filter rows",
          "Sort rows",
          "Limit rows",
        ]),
      );
    },
  );

  // (e)
  it("a draft inserted after B whose anchor B is then deleted is sent as an append (rootId, no position) and succeeds", async () => {
    deletePipelineStepMock.mockReturnValue(new Promise(() => {})); // the delete never settles
    const create = deferredCreate();
    renderPage();
    await screen.findByRole("button", { name: /Limit rows/i });
    await insertAt(2, /Generate text/i); // after B
    fireEvent.click(screen.getByRole("button", { name: /Filter rows/i, expanded: false }));
    fireEvent.click(
      within(
        screen
          .getByRole("button", { name: /Filter rows/i })
          .closest(".pipeline-detail-page__step-card") as HTMLElement,
      ).getByRole("button", { name: "Remove step" }),
    );
    await completeFirstDraft(1);

    expect(createPipelineStepMock).toHaveBeenLastCalledWith(
      "pipe-1",
      "generatetext",
      expect.anything(),
      undefined,
      undefined,
      undefined,
      "root-1",
    );
    await create.resolve(createdResp(ps("N", "generatetext", { parent: "C" }), []));
    await waitFor(() =>
      expect(screen.queryByText(/draft.*not yet saved/i)).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /Generate text/i })).toBeInTheDocument();
  });

  // (f)
  it("an insert in flight while a duplicate's full sync drops its temp: the created step appears exactly once", async () => {
    duplicatePipelineStepMock.mockResolvedValue(ps("A2", "rename", { parent: "A" }));
    const create = deferredCreate();
    renderPage();
    await screen.findByRole("button", { name: /Limit rows/i });
    await insertAt(2, /Cast type/i);
    await waitFor(() => expect(createPipelineStepMock).toHaveBeenCalledTimes(1));
    // The duplicate's sync returns the server list WITHOUT the in-flight step.
    getPipelineStepsMock.mockResolvedValue([
      A(),
      ps("A2", "rename", { parent: "A", position: 1 }),
      B(),
      C(),
    ]);
    fireEvent.click(
      within(
        screen
          .getByRole("button", { name: /Rename column/i })
          .closest(".pipeline-detail-page__step-card") as HTMLElement,
      ).getByRole("button", { name: "Duplicate step" }),
    );
    await waitFor(() => expect(getPipelineStepsMock).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(screen.queryByRole("button", { name: /Cast type/i })).not.toBeInTheDocument();

    await create.resolve(createdResp(ps("N", "cast", { parent: "B" }), ["C"]));

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /Cast type/i })).toHaveLength(1),
    );
  });

  it("an insert whose created id a duplicate's full sync already brought in is not duplicated", async () => {
    duplicatePipelineStepMock.mockResolvedValue(ps("A2", "rename", { parent: "A" }));
    const create = deferredCreate();
    renderPage();
    await screen.findByRole("button", { name: /Limit rows/i });
    await insertAt(2, /Cast type/i);
    await waitFor(() => expect(createPipelineStepMock).toHaveBeenCalledTimes(1));
    getPipelineStepsMock.mockResolvedValue([
      A(),
      B(),
      ps("N", "cast", { parent: "B" }),
      ps("C", "limit", { parent: "N" }),
    ]);
    fireEvent.click(
      within(
        screen
          .getByRole("button", { name: /Rename column/i })
          .closest(".pipeline-detail-page__step-card") as HTMLElement,
      ).getByRole("button", { name: "Duplicate step" }),
    );
    await waitFor(() => expect(getPipelineStepsMock).toHaveBeenCalledTimes(2));
    await act(async () => {});

    await create.resolve(createdResp(ps("N", "cast", { parent: "B" }), ["C"]));

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /Cast type/i })).toHaveLength(1),
    );
    expect(labelsInOrder()).toEqual(["Rename column", "Filter rows", "Cast type", "Limit rows"]);
  });

  // (h)
  it("trunk-last B with a tail lane L: two bottom-row appends answered in reverse commit order leave L under P2, as the server has it", async () => {
    getPipelineStepsMock.mockResolvedValue([
      A(),
      ps("B", "filter", { parent: "A" }),
      ps("L", "limit", { parent: "B", position: 1 }),
    ]);
    const createP1 = deferredCreate();
    renderPage();
    await screen.findByRole("button", { name: /Limit rows/i });
    await appendBottom(/Cast type/i); // P1
    const createP2 = deferredCreate();
    await appendBottom(/Sort rows/i); // P2
    await waitFor(() => expect(createPipelineStepMock).toHaveBeenCalledTimes(2));
    // appends: rootId, no position, no parent
    expect(createPipelineStepMock.mock.calls.map((c) => [c[3], c[4], c[6]])).toEqual([
      [undefined, undefined, "root-1"],
      [undefined, undefined, "root-1"],
    ]);

    // Server: P1 splices onto B (L moves under P1), then P2 onto P1 (L moves under P2).
    await createP2.resolve(createdResp(ps("P2", "sort", { parent: "P1" }), ["L"]));
    await createP1.resolve(createdResp(ps("P1", "cast", { parent: "B" }), ["L"]));

    await waitFor(() => expect(laneParentLabel(/Limit rows/i)).toBe("Sort rows"));
  });

  // (i) HEL-1340 handoff: "a trunk-append AI draft vanishes until reload". Probe-confirmed root
  // cause (probe-evidence.md): the backend head-spliced every rootId create, so the appended step
  // came back as a SECOND root-level step of the root and the river rendered neither it nor a lane
  // for it, until a reload re-read the tree. With the backend placement fixed the response is a
  // trunk continuation; this guards the editor side of that contract.
  it("a trunk-append AI draft stays on screen after its create and after a later full sync", async () => {
    const create = deferredCreate();
    renderPage();
    await screen.findByRole("button", { name: /Limit rows/i });
    await appendBottom(/Generate text/i);
    await completeFirstDraft(1);
    // The append is a root-level request: rootId, no position, no parent.
    expect(createPipelineStepMock).toHaveBeenLastCalledWith(
      "pipe-1",
      "generatetext",
      expect.anything(),
      undefined,
      undefined,
      undefined,
      "root-1",
    );

    await create.resolve(createdResp(ps("N", "generatetext", { parent: "C" }), []));
    await waitFor(() =>
      expect(screen.queryByText(/draft.*not yet saved/i)).not.toBeInTheDocument(),
    );
    expect(labelsInOrder()).toEqual([
      "Rename column",
      "Filter rows",
      "Limit rows",
      "Generate text",
    ]);

    // A later full sync (a duplicate elsewhere) keeps it, in the same place.
    duplicatePipelineStepMock.mockResolvedValue(ps("A2", "rename", { parent: "A", position: 1 }));
    getPipelineStepsMock.mockResolvedValue([
      A(),
      ps("A2", "rename", { parent: "A", position: 1 }),
      B(),
      C(),
      ps("N", "generatetext", { parent: "C" }),
    ]);
    fireEvent.click(
      within(
        screen
          .getByRole("button", { name: /Rename column/i })
          .closest(".pipeline-detail-page__step-card") as HTMLElement,
      ).getByRole("button", { name: "Duplicate step" }),
    );
    await waitFor(() => expect(getPipelineStepsMock).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(screen.getAllByRole("button", { name: /Generate text/i })).toHaveLength(1);
  });

  // (g)
  it("a trunk draft's schema fallback is unchanged by the insert anchor (it is not read as a lane draft)", async () => {
    // Only the root source exposes `notes`; the draft sits mid-trunk with an insert anchor.
    renderPage();
    await screen.findByRole("button", { name: /Limit rows/i });
    await insertAt(1, /Generate text/i);
    fireEvent.click(
      (await screen.findAllByRole("button", { name: /Generate text/i, expanded: false }))[0],
    );
    fireEvent.click(screen.getByRole("combobox", { name: /input field to generate from/i }));
    expect(screen.getByRole("option", { name: "notes" })).toBeInTheDocument();
  });
});
