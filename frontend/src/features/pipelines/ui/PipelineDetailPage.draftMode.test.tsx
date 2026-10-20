// HEL-1631: the desktop pipeline page in draft mode. Editing a step makes a client-only draft; counts and the preview recompute
// in the browser; nothing is written until Save & run, whose every outcome is covered here (a started run, a refused run, a
// stale base, a cascade confirmation, a validation failure, Undo and its refusal). The phone's draft slot is covered in
// PipelineMobileLayout.test.tsx; the zero-request guarantee over a real network in e2e/hel1631-draft-mode.spec.ts.

import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import {
  analyzePipeline,
  createPipelineStep,
  deletePipelineStep,
  fetchRunHistory,
  fetchStepPreview,
  getPipelineById,
  getPipelineSchedule,
  getPipelineStepCatalog,
  getPipelineSteps,
  reorderPipelineSteps,
  runPipeline,
  updatePipelineStep,
  updatePipelineStepEnabled,
} from "../services/pipelineService";
import { previewOutputs } from "../services/outputService";
import { getPipelineWithDefinition, saveDraft } from "../services/draftSaveService";
import { undoPatchSet } from "../../patchSets/services/patchSetService";
import { httpClient } from "../../../services/httpClient";
import type { SourceSample } from "../../sources/types/dataSource";
import type { Toast } from "../../toasts/state/toastsSlice";
import type { DraftSaveResponse } from "../types/draftSave";
import type { PipelineStep, PipelineSummary } from "../types/pipelineStep";
import {
  SPINE_PIPELINE,
  analyzeFor,
  makeOutput,
  makeSpineStore,
  renderSpinePageSettled,
  threeSteps,
  wireStep,
} from "./pipelineSpineTestKit";

jest.mock("../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

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
  putPipelineSchedule: jest.fn(),
  deletePipelineSchedule: jest.fn(),
  getPipelineShapeCatalog: jest.fn(),
  getPipelineStepCatalog: jest.fn(),
  expandPipelineShape: jest.fn(),
  reorderPipelineSteps: jest.fn(),
  updatePipelineStepEnabled: jest.fn(),
  duplicatePipelineStep: jest.fn(),
  listPipelinePermissions: jest.fn(),
  grantPipelinePermission: jest.fn(),
  revokePipelinePermission: jest.fn(),
  addPipelineRoot: jest.fn(),
  removePipelineRoot: jest.fn(),
}));

jest.mock("../services/outputService", () => ({
  ...jest.requireActual("../services/outputService"),
  previewOutputs: jest.fn(),
}));

jest.mock("../services/draftSaveService", () => ({
  ...jest.requireActual("../services/draftSaveService"),
  getPipelineWithDefinition: jest.fn(),
  saveDraft: jest.fn(),
}));

jest.mock("../../patchSets/services/patchSetService", () => ({
  undoPatchSet: jest.fn(),
}));

const getStepsMock = jest.mocked(getPipelineSteps);
const getByIdMock = jest.mocked(getPipelineById);
const previewMock = jest.mocked(fetchStepPreview);
const analyzeMock = jest.mocked(analyzePipeline);
const readDefinitionMock = jest.mocked(getPipelineWithDefinition);
const saveMock = jest.mocked(saveDraft);
const undoMock = jest.mocked(undoPatchSet);
const runMock = jest.mocked(runPipeline);

const DURATIONS = [100, 150, 180, 200, 250, 300];
const SAMPLE: SourceSample = {
  rows: DURATIONS.map((d, i) => ({ date: `2026-09-0${i + 1}`, status: "ok", duration_s: d })),
  capturedAt: "2026-10-19T00:00:00Z",
  sourceRowCount: DURATIONS.length,
  truncated: false,
  live: false,
};

const FINGERPRINT = "v1:" + "a".repeat(64);

const definitionOf = (steps: PipelineStep[]): PipelineSummary =>
  ({
    ...SPINE_PIPELINE,
    fingerprint: FINGERPRINT,
    definition: { steps, outputs: [] },
  }) as PipelineSummary;

const savedResponse = (run: DraftSaveResponse["run"], steps = threeSteps()): DraftSaveResponse => ({
  saved: {
    fingerprint: "v1:" + "b".repeat(64),
    definition: { steps, outputs: [] },
    applicationId: "app-1",
  },
  run,
});

const axiosError = (status: number, data: unknown) => ({
  isAxiosError: true,
  response: { status, data },
});

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

beforeEach(() => {
  jest.mocked(httpClient.get).mockResolvedValue({ data: { columns: [], capabilities: {} } });
  jest.mocked(fetchRunHistory).mockResolvedValue([]);
  getByIdMock.mockResolvedValue(SPINE_PIPELINE);
  jest.mocked(getPipelineStepCatalog).mockResolvedValue({ groups: [], steps: [] });
  jest
    .mocked(getPipelineSchedule)
    .mockRejectedValue({ isAxiosError: true, response: { status: 404 } });
  getStepsMock.mockResolvedValue(threeSteps());
  analyzeMock.mockResolvedValue(analyzeFor(threeSteps()));
  previewMock.mockResolvedValue({ rows: [{ date: "2026-09-14" }], rowCount: 1 });
  readDefinitionMock.mockResolvedValue(definitionOf(threeSteps()));
  saveMock.mockResolvedValue(savedResponse({ started: true, runId: "r1", status: "succeeded" }));
  runMock.mockResolvedValue({ rowCount: 0, rows: [], stepRowCounts: {}, sourceRowCount: 0 });
  undoMock.mockResolvedValue({ edits: [] });
});

afterEach(() => {
  jest.clearAllMocks();
});

const spine = () => screen.getByLabelText("Steps and outputs");
const rowTitles = () =>
  Array.from(document.querySelectorAll(".spine-row__title")).map((el) => el.textContent ?? "");
const rowButton = (n: number, label: string) =>
  within(spine()).getByRole("button", { name: new RegExp(`^Step ${n}: ${label}`) });
const rowCount = (n: number, label: string) =>
  rowButton(n, label).querySelector(".spine-row__count")?.textContent;

async function renderDraftPage(options: Parameters<typeof makeSpineStore>[0] = {}) {
  const store = makeSpineStore({ samples: { "src-1": SAMPLE }, outputs: [], ...options });
  await renderSpinePageSettled(store);
  await screen.findByRole("region", { name: "Step 1 Filter rows" });
  return store;
}

function editThreshold(value: string) {
  fireEvent.change(screen.getByDisplayValue("180"), { target: { value } });
}

const toastsOf = (store: ReturnType<typeof makeSpineStore>): Toast[] =>
  (store.getState() as { toasts: { items: Toast[] } }).toasts.items;

const saveButton = () => screen.getByRole("button", { name: "Save and run" });

describe("draft mode: header, counts and preview", () => {
  it("shows no draft chip and the Dry run / Run buttons until something is edited", async () => {
    await renderDraftPage();
    expect(screen.queryByText("Draft · unsaved changes")).toBeNull();
    expect(screen.getByRole("button", { name: "Dry run" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run pipeline" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Discard draft" })).toBeNull();
  });

  it("an edit shows the chip, Discard and Save & run in place of Dry run and Run, and the counts as 'saved → draft'", async () => {
    await renderDraftPage();
    editThreshold("240");

    expect(screen.getByText("Draft · unsaved changes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard draft" })).toBeEnabled();
    expect(saveButton()).toHaveTextContent("Save & run");
    expect(screen.queryByRole("button", { name: "Dry run" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Run pipeline" })).toBeNull();

    expect(rowCount(1, "Filter rows")).toBe("4 → 2");
    expect(rowButton(1, "Filter rows")).toHaveAccessibleName(/4 rows saved, 2 in draft/);
    // The sort and compute steps downstream see the filter's new output.
    expect(rowCount(2, "Sort rows")).toBe("4 → 2");
  });

  it("the preview table shows the draft rows with a live marker, and sends no step-preview request for the edit", async () => {
    await renderDraftPage();
    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(1));
    const before = previewMock.mock.calls.length;

    editThreshold("240");

    const table = await screen.findByRole("region", { name: "Rows after step 1" });
    expect(within(table).getByText("2 rows")).toBeInTheDocument();
    expect(within(table).getByLabelText("Preview is live")).toHaveTextContent("live");
    expect(within(table).getByText("250")).toBeInTheDocument();
    expect(within(table).queryByText("180")).toBeNull();
    expect(previewMock.mock.calls.length).toBe(before);
  });

  it("a burst of edits sends no request of any kind: no PATCH, no analyze, no preview, no write", async () => {
    await renderDraftPage();
    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(1));
    const analyzeBefore = analyzeMock.mock.calls.length;
    const previewBefore = previewMock.mock.calls.length;

    let current = "180";
    for (const next of ["181", "182", "190", "200", "210", "220", "230", "240", "250", "260"]) {
      fireEvent.change(screen.getByDisplayValue(current), { target: { value: next } });
      current = next;
    }
    await act(async () => {
      await new Promise((r) => setTimeout(r, 800));
    });

    expect(rowCount(1, "Filter rows")).toBe("4 → 1");
    expect(jest.mocked(updatePipelineStep)).not.toHaveBeenCalled();
    expect(jest.mocked(updatePipelineStepEnabled)).not.toHaveBeenCalled();
    expect(jest.mocked(deletePipelineStep)).not.toHaveBeenCalled();
    expect(jest.mocked(createPipelineStep)).not.toHaveBeenCalled();
    expect(jest.mocked(reorderPipelineSteps)).not.toHaveBeenCalled();
    expect(analyzeMock.mock.calls.length).toBe(analyzeBefore);
    expect(previewMock.mock.calls.length).toBe(previewBefore);
    expect(httpClient.post).not.toHaveBeenCalled();
    expect(httpClient.patch).not.toHaveBeenCalled();
    expect(httpClient.delete).not.toHaveBeenCalled();
  });

  it("an error in a step freezes the steps after it at their last good counts, marked stale", async () => {
    const steps = [
      ...threeSteps().slice(0, 2),
      wireStep(
        "s3",
        "compute",
        { column: "duration_min", expression: "$duration_s / 60" },
        { parentStepId: "s2", position: 0, rootId: undefined },
      ),
      wireStep(
        "s4",
        "limit",
        { count: 10 },
        { parentStepId: "s3", position: 0, rootId: undefined },
      ),
    ];
    getStepsMock.mockResolvedValue(steps);
    readDefinitionMock.mockResolvedValue(definitionOf(steps));
    await renderDraftPage();

    fireEvent.click(rowButton(3, "Compute column"));
    fireEvent.change(await screen.findByRole("textbox", { name: "Expression" }), {
      target: { value: "$duration_s /" },
    });

    expect(
      within(rowButton(3, "Compute column")).getByRole("img", { name: /error in the draft/i }),
    ).toBeInTheDocument();
    expect(rowButton(4, "Limit rows")).toHaveAccessibleName(
      /4 rows in draft, an earlier step has an error, showing its last result/,
    );
    expect(within(rowButton(4, "Limit rows")).getByText("stale")).toBeInTheDocument();
    expect(rowCount(4, "Limit rows")).toBe("4");
  });

  it("an AI step and the steps after it read 'not previewed (AI step): runs on Save & run' and send nothing", async () => {
    const steps = [
      ...threeSteps().slice(0, 2),
      wireStep(
        "ai1",
        "generatetext",
        { inputField: "date", instruction: "x", outputField: "o" },
        { parentStepId: "s2", position: 0, rootId: undefined },
      ),
    ];
    getStepsMock.mockResolvedValue(steps);
    readDefinitionMock.mockResolvedValue(definitionOf(steps));
    await renderDraftPage();
    editThreshold("240");

    expect(rowButton(3, "Generate text")).toHaveAccessibleName(
      /not previewed \(AI step\): runs on Save & run/,
    );
    expect(httpClient.post).not.toHaveBeenCalled();
  });
});

describe("draft mode: Discard", () => {
  it("restores the saved pipeline exactly with no request: rows, counts, editor value and header", async () => {
    await renderDraftPage();
    const titlesBefore = rowTitles();
    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(1));
    const previewBefore = previewMock.mock.calls.length;
    const analyzeBefore = analyzeMock.mock.calls.length;

    editThreshold("240");
    fireEvent.click(screen.getByRole("button", { name: "Disable step" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 800));
    });

    expect(screen.queryByText("Draft · unsaved changes")).toBeNull();
    expect(screen.getByRole("button", { name: "Run pipeline" })).toBeInTheDocument();
    expect(rowTitles()).toEqual(titlesBefore);
    expect(screen.getByDisplayValue("180")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disable step" })).toBeInTheDocument();
    expect(rowCount(1, "Filter rows")).toBe("—");
    expect(previewMock.mock.calls.length).toBe(previewBefore);
    expect(analyzeMock.mock.calls.length).toBe(analyzeBefore);
    expect(httpClient.post).not.toHaveBeenCalled();
  });
});

describe("draft mode: structural operations are blocked while a draft exists", () => {
  it("disables add, insert, branch, move, add-output and duplicate with the reason, and enables them again after Discard", async () => {
    await renderDraftPage();
    editThreshold("240");
    const reason = "Save or discard your draft first";

    const add = within(spine()).getByRole("button", { name: "+ Add transformation step" });
    expect(add).toBeDisabled();
    expect(add).toHaveAccessibleDescription(reason);
    expect(within(spine()).getByRole("button", { name: "New output" })).toBeDisabled();
    expect(within(spine()).getByRole("button", { name: "Add source" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Duplicate step" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Step actions for Filter rows" }));
    const menu = screen.getByRole("menu", { name: "Step actions for Filter rows" });
    for (const name of [
      /^Move step down/,
      /^Insert step before/,
      /^Insert step after/,
      /^Branch from here/,
      /^Add output/,
    ]) {
      const item = within(menu).getByRole("menuitem", { name });
      expect(item).toBeDisabled();
      expect(item).toHaveAttribute("title", reason);
    }
    fireEvent.keyDown(menu, { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(
      within(spine()).getByRole("button", { name: "+ Add transformation step" }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "Duplicate step" })).toBeEnabled();
  });
});

describe("draft mode: Save & run", () => {
  it("posts ONE draft save with the final tree, an explicit enabled on every step and runAfterSave, then shows the saved pipeline", async () => {
    const store = await renderDraftPage();
    editThreshold("240");
    fireEvent.click(rowButton(2, "Sort rows"));
    fireEvent.click(screen.getByRole("button", { name: "Disable step" }));

    await act(async () => {
      fireEvent.click(saveButton());
    });

    expect(saveMock).toHaveBeenCalledTimes(1);
    const [pipelineId, request] = saveMock.mock.calls[0];
    expect(pipelineId).toBe("pipe-1");
    expect(request).toMatchObject({
      baseFingerprint: FINGERPRINT,
      runAfterSave: "run",
      outputs: [],
    });
    expect(request.steps.map((s) => [s.id, s.enabled])).toEqual([
      ["s1", true],
      ["s2", false],
      ["s3", true],
    ]);
    expect(request.steps[0].config).toEqual({
      combinator: "AND",
      conditions: [{ field: "duration_s", operator: ">=", value: "240" }],
    });
    expect(request.steps[0]).toMatchObject({ rootId: "root-1" });
    expect(request.steps[1]).toMatchObject({ parentStepId: "s1" });
    expect(request.confirmCascade).toBeUndefined();

    expect(screen.queryByText("Draft · unsaved changes")).toBeNull();
    expect(screen.getByRole("button", { name: "Run pipeline" })).toBeInTheDocument();
    const toasts = toastsOf(store);
    expect(toasts.map((t) => t.message)).toContain("Saved.");
    expect(toasts.find((t) => t.message === "Saved.")?.action?.label).toBe("Undo");
    expect(runMock).not.toHaveBeenCalled();
    expect(store.getState().pipelines.runStatus).toBe("succeeded");
  });

  it("keeps a disabled step disabled in the request", async () => {
    getStepsMock.mockResolvedValue([
      threeSteps()[0],
      { ...threeSteps()[1], enabled: false } as PipelineStep,
      threeSteps()[2],
    ]);
    readDefinitionMock.mockResolvedValue(
      definitionOf([
        threeSteps()[0],
        { ...threeSteps()[1], enabled: false } as PipelineStep,
        threeSteps()[2],
      ]),
    );
    await renderDraftPage();
    editThreshold("240");
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(saveMock.mock.calls[0][1].steps.map((s) => s.enabled)).toEqual([true, false, true]);
  });

  it("shows the run as queued while the save is open, and disables Save & run and Discard meanwhile", async () => {
    let finish: (r: DraftSaveResponse) => void = () => {};
    saveMock.mockReturnValue(new Promise<DraftSaveResponse>((resolve) => (finish = resolve)));
    const store = await renderDraftPage();
    editThreshold("240");
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(store.getState().pipelines.runStatus).toBe("queued");
    expect(screen.getByLabelText("Run status: queued")).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discard draft" })).toBeDisabled();
    await act(async () =>
      finish(savedResponse({ started: true, runId: "r1", status: "succeeded" })),
    );
    expect(store.getState().pipelines.runStatus).toBe("succeeded");
  });

  it("a run the HEL-505 guard refused: saved, not started, with the retry time and a Run now action; no error banner", async () => {
    saveMock.mockResolvedValue(
      savedResponse({
        started: false,
        code: 429,
        retryAfterSeconds: 12,
        reason: "Pipeline run rate limit exceeded",
      }),
    );
    const store = await renderDraftPage();
    editThreshold("240");
    await act(async () => {
      fireEvent.click(saveButton());
    });

    const toasts = toastsOf(store);
    const refused = toasts.find((t) => t.message.startsWith("Saved. Run not started"));
    expect(refused?.message).toBe("Saved. Run not started: rate limit, retry in 12 s");
    expect(refused?.action?.label).toBe("Run now");
    expect(store.getState().pipelines.runError).toBeNull();
    expect(store.getState().pipelines.runStatus).toBeNull();
    expect(screen.queryByText("Draft · unsaved changes")).toBeNull();

    await act(async () => {
      refused?.action?.onClick();
    });
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it("a stale base (409) offers ONLY 'Reload the saved pipeline' and keeps the draft", async () => {
    saveMock.mockRejectedValue(
      axiosError(409, {
        code: "PATCH_SET_STALE",
        currentFingerprint: "v1:" + "c".repeat(64),
        staleTargets: [{ index: 0, kind: "pipeline", id: "pipe-1" }],
      }),
    );
    await renderDraftPage();
    editThreshold("240");
    await act(async () => {
      fireEvent.click(saveButton());
    });

    const alert = await screen.findByText("This pipeline changed since you started editing.");
    const region = alert.closest('[role="alert"]') as HTMLElement;
    expect(
      within(region)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Reload the saved pipeline"]);
    expect(screen.queryByRole("button", { name: /overwrite|force|save anyway/i })).toBeNull();
    expect(screen.getByText("Draft · unsaved changes")).toBeInTheDocument();
  });

  it("a base that already differs from the saved definition is reported without posting, and Reload re-applies the draft", async () => {
    readDefinitionMock.mockResolvedValue(
      definitionOf([
        threeSteps()[0],
        {
          ...threeSteps()[1],
          position: 0,
          config: { sortBy: [{ field: "status", direction: "asc" }] },
        } as PipelineStep,
        threeSteps()[2],
      ]),
    );
    await renderDraftPage();
    editThreshold("240");
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(saveMock).not.toHaveBeenCalled();
    expect(
      await screen.findByText("This pipeline changed since you started editing."),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reload the saved pipeline" }));
    });
    expect(screen.queryByText("This pipeline changed since you started editing.")).toBeNull();
    expect(screen.getByText("Draft · unsaved changes")).toBeInTheDocument();
    expect(screen.getByDisplayValue("240")).toBeInTheDocument();
    expect(rowCount(1, "Filter rows")).toBe("4 → 2");
  });

  it("after a reload, edits to steps that are gone are reported as no longer applying", async () => {
    saveMock.mockRejectedValue(axiosError(409, { code: "PATCH_SET_STALE", staleTargets: [] }));
    await renderDraftPage();
    editThreshold("240");
    fireEvent.click(rowButton(3, "Compute column"));
    fireEvent.change(await screen.findByRole("textbox", { name: "Output field name" }), {
      target: { value: "mins" },
    });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    await screen.findByText("This pipeline changed since you started editing.");

    readDefinitionMock.mockResolvedValue(definitionOf(threeSteps().slice(0, 2)));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reload the saved pipeline" }));
    });

    expect(await screen.findByText(/1 of your edits no longer apply/)).toBeInTheDocument();
    expect(screen.getByText("Draft · unsaved changes")).toBeInTheDocument();
    expect(rowTitles()).toEqual(["Filter rows", "Sort rows"]);
  });

  it("a save that would remove other things asks first, lists them, and resends with the confirmation only on confirm", async () => {
    const impact = {
      stepIds: ["s3"],
      outputIds: ["o1"],
      panelIds: ["p1", "p2"],
      alertRuleIds: ["a1"],
      hints: ["Remove the panels first to keep their data."],
    };
    saveMock.mockRejectedValueOnce(
      axiosError(422, { code: "CASCADE_CONFIRMATION_REQUIRED", impact }),
    );
    await renderDraftPage({ outputs: [makeOutput("o1", "Revenue table")] });
    fireEvent.click(rowButton(3, "Compute column"));
    fireEvent.click(await screen.findByRole("button", { name: "Remove step" }));
    await act(async () => {
      fireEvent.click(saveButton());
    });

    const dialog = await screen.findByRole("dialog", { name: "Confirm removals" });
    expect(within(dialog).getByText("Step: Compute column")).toBeInTheDocument();
    expect(within(dialog).getByText("Output: Revenue table")).toBeInTheDocument();
    expect(within(dialog).getByText("2 panels bound to those Outputs")).toBeInTheDocument();
    expect(within(dialog).getByText("1 alert rule on those Outputs")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Remove the panels first to keep their data."),
    ).toBeInTheDocument();
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock.mock.calls[0][1].steps.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(saveMock.mock.calls[0][1].outputs).toEqual([]);

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Remove and save" }));
    });
    expect(saveMock).toHaveBeenCalledTimes(2);
    expect(saveMock.mock.calls[1][1].confirmCascade).toEqual({
      stepIds: ["s3"],
      outputIds: ["o1"],
      panelIds: ["p1", "p2"],
      alertRuleIds: ["a1"],
    });
  });

  it("cancelling the cascade confirmation keeps the draft and saves nothing more", async () => {
    saveMock.mockRejectedValueOnce(
      axiosError(422, {
        code: "CASCADE_CONFIRMATION_REQUIRED",
        impact: { stepIds: ["s3"], outputIds: [], panelIds: [], alertRuleIds: [], hints: [] },
      }),
    );
    await renderDraftPage();
    fireEvent.click(rowButton(3, "Compute column"));
    fireEvent.click(await screen.findByRole("button", { name: "Remove step" }));
    await act(async () => {
      fireEvent.click(saveButton());
    });
    const dialog = await screen.findByRole("dialog", { name: "Confirm removals" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Confirm removals" })).toBeNull(),
    );
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Draft · unsaved changes")).toBeInTheDocument();
  });

  it("a validation failure (400) keeps the draft and names the step the server named", async () => {
    saveMock.mockRejectedValue(
      axiosError(400, { message: "Step s1 has an invalid filter: operator '??' is not supported" }),
    );
    const store = await renderDraftPage();
    editThreshold("240");
    await act(async () => {
      fireEvent.click(saveButton());
    });

    const alert = await screen.findByText(/Couldn't save step "Filter rows"/);
    expect(alert).toHaveTextContent("operator '??' is not supported");
    expect(screen.getByText("Draft · unsaved changes")).toBeInTheDocument();
    expect(store.getState().pipelines.runError).toBeNull();
    expect(store.getState().pipelines.runStatus).toBeNull();
  });
});

describe("draft mode: Undo", () => {
  async function saveOnce() {
    const store = await renderDraftPage();
    editThreshold("240");
    await act(async () => {
      fireEvent.click(saveButton());
    });
    const undo = toastsOf(store).find((t) => t.message === "Saved.")!.action!;
    return { store, undo };
  }

  it("undoes the save by its application id and reloads the saved definition", async () => {
    const { store, undo } = await saveOnce();
    readDefinitionMock.mockResolvedValue(definitionOf(threeSteps()));
    await act(async () => {
      undo.onClick();
    });
    expect(undoMock).toHaveBeenCalledWith("app-1");
    expect(toastsOf(store).map((t) => t.message)).toContain("Undone.");
  });

  it("shows the server's 409 naming what blocks it and leaves the saved pipeline unchanged", async () => {
    undoMock.mockRejectedValue(
      axiosError(409, { message: 'panel p1 (Output o1); alert rule a1 "Low revenue" (Output o1)' }),
    );
    const { undo } = await saveOnce();
    await act(async () => {
      undo.onClick();
    });

    const alert = await screen.findByText(/Undo was refused, nothing changed/);
    expect(alert).toHaveTextContent(
      'panel p1 (Output o1); alert rule a1 "Low revenue" (Output o1)',
    );
    expect(rowCount(1, "Filter rows")).toBe("—");
  });

  it("with a newer draft open, asks before undoing, since undo replaces the saved pipeline", async () => {
    const { undo } = await saveOnce();
    editThreshold("200");
    await act(async () => {
      undo.onClick();
    });
    expect(undoMock).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Discard draft and undo" }));
    });
    expect(undoMock).toHaveBeenCalledWith("app-1");
    expect(screen.queryByText("Draft · unsaved changes")).toBeNull();
  });
});

describe("draft mode: after Save & run", () => {
  it("refreshes the Output previews of the SAVED definition only: an Output the save removed is never requested (skeptic-final-1 CR3)", async () => {
    jest
      .mocked(previewOutputs)
      .mockResolvedValue({ outputs: [], errors: [] } as unknown as Awaited<
        ReturnType<typeof previewOutputs>
      >);
    saveMock.mockResolvedValue({
      saved: {
        fingerprint: "v1:" + "b".repeat(64),
        definition: {
          steps: threeSteps().slice(0, 2),
          outputs: [makeOutput("o2", "Kept", { nodeStepId: "s2" })],
        },
        applicationId: "app-1",
      },
      run: { started: true, runId: "r1", status: "succeeded" },
    } as DraftSaveResponse);
    await renderDraftPage({
      outputs: [makeOutput("o1", "Removed"), makeOutput("o2", "Kept", { nodeStepId: "s2" })],
    });
    jest.mocked(previewOutputs).mockClear();
    editThreshold("240");
    await act(async () => {
      fireEvent.click(saveButton());
    });
    const requested = jest.mocked(previewOutputs).mock.calls.map((c) => c[1]);
    expect(requested).toContain("o2");
    expect(requested).not.toContain("o1");
  });

  it("the Saved toast's Undo is gone after a successful Undo, and a second Undo is not possible (skeptic-final-1 CR2)", async () => {
    const store = await renderDraftPage();
    editThreshold("240");
    await act(async () => {
      fireEvent.click(saveButton());
    });
    const saved = toastsOf(store).find((t) => t.message === "Saved.")!;
    readDefinitionMock.mockResolvedValue(definitionOf(threeSteps()));
    await act(async () => {
      saved.action!.onClick();
    });
    await act(async () => {
      saved.action!.onClick();
    });
    expect(undoMock).toHaveBeenCalledTimes(1);
    const after = toastsOf(store);
    expect(after.map((t) => t.message)).toContain("Undone.");
    expect(after.some((t) => t.action?.label === "Undo")).toBe(false);
  });
});

describe("draft mode: kept across leaving the page", () => {
  it("re-applies the draft when the page is opened again in the same tab, and drops it on Discard (skeptic-final-1 CR1)", async () => {
    const first = await renderDraftPage();
    editThreshold("240");
    expect(screen.getByText("Draft · unsaved changes")).toBeInTheDocument();
    expect(first).toBeDefined();
    cleanup();

    await renderDraftPage();
    expect(await screen.findByText("Draft · unsaved changes")).toBeInTheDocument();
    expect(rowCount(1, "Filter rows")).toBe("4 → 2");

    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    cleanup();
    await renderDraftPage();
    expect(screen.queryByText("Draft · unsaved changes")).toBeNull();
  });

  it("a kept draft made against different saved steps is restored but flagged stale: Save & run is refused until Reload (skeptic-final-2)", async () => {
    await renderDraftPage();
    editThreshold("240");
    cleanup();
    // The pipeline changed while away: the stored base no longer matches the saved steps.
    const key = Object.keys(window.sessionStorage).find((k) =>
      k.startsWith("helio.pipelineDraft."),
    )!;
    const kept = JSON.parse(window.sessionStorage.getItem(key)!) as { base: string };
    window.sessionStorage.setItem(
      key,
      JSON.stringify({ ...kept, base: "an older saved pipeline" }),
    );

    await renderDraftPage();
    expect(
      await screen.findByText("This pipeline changed since you started editing."),
    ).toBeInTheDocument();
    expect(screen.getByText("Draft · unsaved changes")).toBeInTheDocument();
    saveMock.mockClear();
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(saveMock).not.toHaveBeenCalled();
    expect(readDefinitionMock).toHaveBeenCalledTimes(0);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reload the saved pipeline" }));
    });
    expect(screen.queryByText("This pipeline changed since you started editing.")).toBeNull();
    expect(screen.getByText("Draft · unsaved changes")).toBeInTheDocument();
  });
});
