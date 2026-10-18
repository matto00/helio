// HEL-1579: the desktop spine's editing behaviour -- adding / inserting / branching / reordering / removing /
// disabling / duplicating through spine rows and the row menu, the focused editor's save-on-selection-change
// (flush) rules, the preview table's freshness and ordering rules (design.md D7/D8), the creating-step guard, the
// steps-fetch failure state and the Output hooks. Each assertion that used to target a card or a river gap on
// desktop is recorded against its replacement here in the change's `test-migration.md`.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";

import {
  analyzePipeline,
  createPipelineStep,
  deletePipelineStep,
  duplicatePipelineStep,
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
import type { PipelineStepCatalog } from "../types/pipelineStepCatalog";
import type { PipelineStep } from "../types/pipelineStep";
import { httpClient } from "../../../services/httpClient";
import {
  SPINE_PIPELINE,
  analyzeFor,
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

const getStepsMock = jest.mocked(getPipelineSteps);
const analyzeMock = jest.mocked(analyzePipeline);
const previewMock = jest.mocked(fetchStepPreview);
const createMock = jest.mocked(createPipelineStep);
const updateStepMock = jest.mocked(updatePipelineStep);
const deleteMock = jest.mocked(deletePipelineStep);
const duplicateMock = jest.mocked(duplicatePipelineStep);
const reorderMock = jest.mocked(reorderPipelineSteps);
const enabledMock = jest.mocked(updatePipelineStepEnabled);
const runMock = jest.mocked(runPipeline);

const CATALOG: PipelineStepCatalog = {
  groups: [{ id: "filter-shape", label: "Filter & shape" }],
  steps: [
    {
      kind: "select",
      label: "Select fields",
      description: "Keep only the selected columns.",
      group: "filter-shape",
      authorable: true,
    },
    {
      kind: "limit",
      label: "Limit rows",
      description: "Keep only the first N rows.",
      group: "filter-shape",
      authorable: true,
    },
  ],
};

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
  jest.mocked(getPipelineById).mockResolvedValue(SPINE_PIPELINE);
  jest.mocked(getPipelineStepCatalog).mockResolvedValue(CATALOG);
  jest
    .mocked(getPipelineSchedule)
    .mockRejectedValue({ isAxiosError: true, response: { status: 404 } });
  getStepsMock.mockResolvedValue(threeSteps());
  analyzeMock.mockResolvedValue(analyzeFor(threeSteps()));
  previewMock.mockResolvedValue({ rows: [{ date: "2026-09-14" }], rowCount: 1 });
  updateStepMock.mockImplementation(async (stepId, config) => wireStep(stepId, "sort", config));
  deleteMock.mockResolvedValue(undefined);
  runMock.mockResolvedValue({ rowCount: 0, rows: [], stepRowCounts: {}, sourceRowCount: 0 });
});

afterEach(() => {
  jest.clearAllMocks();
});

const spine = () => screen.getByLabelText("Steps and outputs");
const rowTitles = () =>
  Array.from(document.querySelectorAll(".spine-row__title")).map((el) => el.textContent ?? "");
const rowButton = (n: number, label: string) =>
  within(spine()).getByRole("button", { name: new RegExp(`^Step ${n}: ${label}`) });

function openRowMenu(label: string) {
  fireEvent.click(screen.getByRole("button", { name: `Step actions for ${label}` }));
  return screen.getByRole("menu", { name: `Step actions for ${label}` });
}

async function pickFromPalette(name: RegExp) {
  fireEvent.click(await screen.findByRole("option", { name }));
}

describe("spine editing: adding, inserting and branching", () => {
  const created = wireStep(
    "n1",
    "limit",
    { count: 10 },
    { parentStepId: "s3", position: 0, rootId: undefined },
  );

  it("'+ Add transformation step' appends through the palette, without a position, and selects the new step", async () => {
    createMock.mockResolvedValueOnce(created);
    await renderSpinePageSettled();
    await screen.findByRole("region", { name: "Step 1 Filter rows" });
    fireEvent.click(within(spine()).getByRole("button", { name: "+ Add transformation step" }));
    await pickFromPalette(/Limit rows/i);
    expect(rowTitles()).toEqual(["Filter rows", "Sort rows", "Compute column", "Limit rows"]);
    // The create resolves and swaps the temp id; the new step stays selected throughout.
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Step 4 Limit rows" })).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        "pipe-1",
        "limit",
        expect.anything(),
        undefined,
        undefined,
        undefined,
        "root-1",
      ),
    );
  });

  it("follows a created step through the temp-id to server-id swap without falling back to the first step", async () => {
    createMock.mockResolvedValueOnce(created);
    await renderSpinePageSettled();
    await screen.findByRole("region", { name: "Step 1 Filter rows" });
    await waitFor(() => expect(previewMock).toHaveBeenCalledWith("pipe-1", "s1"));
    previewMock.mockClear();
    fireEvent.click(within(spine()).getByRole("button", { name: "+ Add transformation step" }));
    await pickFromPalette(/Limit rows/i);
    await waitFor(() =>
      expect(
        new URLSearchParams(screen.getByTestId("location-search").textContent ?? "").get("step"),
      ).toBe("n1"),
    );
    expect(rowButton(4, "Limit rows")).toHaveAttribute("aria-current", "true");
    // Never fell back to the default step in between: no preview was requested for s1.
    expect(previewMock.mock.calls.filter(([, id]) => id === "s1")).toHaveLength(0);
  });

  it("'Insert step before' on the first row inserts at position 0 and the new step ends up first", async () => {
    createMock.mockResolvedValueOnce({
      ...created,
      position: 0,
      parentStepId: undefined,
      rootId: "root-1",
      reparentedStepIds: ["s1"],
    } as unknown as Awaited<ReturnType<typeof createPipelineStep>>);
    await renderSpinePageSettled();
    await screen.findByRole("region", { name: "Step 1 Filter rows" });
    fireEvent.click(
      within(openRowMenu("Filter rows")).getByRole("menuitem", { name: "Insert step before" }),
    );
    await pickFromPalette(/Limit rows/i);
    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        "pipe-1",
        "limit",
        expect.anything(),
        0,
        undefined,
        undefined,
        "root-1",
      ),
    );
    await waitFor(() =>
      expect(rowTitles()).toEqual(["Limit rows", "Filter rows", "Sort rows", "Compute column"]),
    );
  });

  it("'Insert step after' on a middle row anchors the create on that step and the new step ends up directly after it", async () => {
    createMock.mockResolvedValueOnce({
      ...created,
      position: 0,
      parentStepId: "s2",
      reparentedStepIds: ["s3"],
    } as unknown as Awaited<ReturnType<typeof createPipelineStep>>);
    await renderSpinePageSettled();
    await screen.findByRole("region", { name: "Step 1 Filter rows" });
    fireEvent.click(
      within(openRowMenu("Sort rows")).getByRole("menuitem", { name: "Insert step after" }),
    );
    await pickFromPalette(/Select fields/i);
    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        "pipe-1",
        "select",
        expect.anything(),
        undefined,
        "s2",
        undefined,
        undefined,
      ),
    );
    await waitFor(() =>
      expect(rowTitles()).toEqual(["Filter rows", "Sort rows", "Limit rows", "Compute column"]),
    );
  });

  it("'Insert step after' on the last trunk row appends (no position, as '+ Add transformation step' does), and the new step is selected and last", async () => {
    createMock.mockResolvedValueOnce(created);
    await renderSpinePageSettled();
    await screen.findByRole("region", { name: "Step 1 Filter rows" });
    fireEvent.click(
      within(openRowMenu("Compute column")).getByRole("menuitem", { name: "Insert step after" }),
    );
    await pickFromPalette(/Limit rows/i);
    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        "pipe-1",
        "limit",
        expect.anything(),
        undefined,
        undefined,
        undefined,
        "root-1",
      ),
    );
    await waitFor(() =>
      expect(rowTitles()).toEqual(["Filter rows", "Sort rows", "Compute column", "Limit rows"]),
    );
    await waitFor(() => expect(rowButton(4, "Limit rows")).toHaveAttribute("aria-current", "true"));
  });

  it("a failed create on the desktop spine shows the inline error in the new step's focused editor (recordCreateError)", async () => {
    createMock.mockRejectedValueOnce(new Error("Request failed with status code 500"));
    await renderSpinePageSettled();
    await screen.findByRole("region", { name: "Step 1 Filter rows" });
    fireEvent.click(
      within(openRowMenu("Compute column")).getByRole("menuitem", { name: "Insert step after" }),
    );
    await pickFromPalette(/Limit rows/i);
    expect(await screen.findByText("Failed to add step.")).toBeVisible();
  });

  it("offers Insert items only on root 0's trunk rows", async () => {
    await renderSpinePageSettled();
    await screen.findByRole("region", { name: "Step 1 Filter rows" });
    const first = openRowMenu("Filter rows");
    expect(within(first).getByRole("menuitem", { name: "Insert step before" })).toBeInTheDocument();
    expect(within(first).getByRole("menuitem", { name: "Insert step after" })).toBeInTheDocument();
    fireEvent.keyDown(first, { key: "Escape" });
    const middle = openRowMenu("Sort rows");
    expect(
      within(middle).queryByRole("menuitem", { name: "Insert step before" }),
    ).not.toBeInTheDocument();
    expect(within(middle).getByRole("menuitem", { name: "Insert step after" })).toBeInTheDocument();
  });

  it("'Branch from here' creates a lane step under the chosen step", async () => {
    createMock.mockReturnValueOnce(new Promise<never>(() => {}));
    await renderSpinePageSettled();
    await screen.findByRole("region", { name: "Step 1 Filter rows" });
    fireEvent.click(
      within(openRowMenu("Sort rows")).getByRole("menuitem", { name: "Branch from here" }),
    );
    await pickFromPalette(/Select fields/i);
    expect(await within(spine()).findByRole("group", { name: "Lane" })).toBeInTheDocument();
    await waitFor(() => expect(createMock).toHaveBeenCalled());
    expect(createMock.mock.calls[0].slice(0, 2)).toEqual(["pipe-1", "select"]);
    expect(createMock.mock.calls[0]).toContain("s2");
  });

  it("'Add output' on a row opens the Output sheet targeted at that step", async () => {
    await renderSpinePageSettled();
    await screen.findByRole("region", { name: "Step 1 Filter rows" });
    fireEvent.click(within(openRowMenu("Sort rows")).getByRole("menuitem", { name: "Add output" }));
    expect(await screen.findByRole("textbox", { name: "Name" })).toBeInTheDocument();
  });

  it("'+ Output' opens the Output sheet with no pre-chosen step", async () => {
    await renderSpinePageSettled();
    await screen.findByRole("region", { name: "Step 1 Filter rows" });
    fireEvent.click(screen.getByRole("button", { name: "New output" }));
    expect(await screen.findByRole("textbox", { name: "Name" })).toBeInTheDocument();
  });
});

describe("spine editing: reorder, remove, disable and duplicate", () => {
  it("Move down in the row menu reorders optimistically and sends the persisted ids only", async () => {
    reorderMock.mockResolvedValueOnce([
      wireStep("s2", "sort", { sortBy: [] }, { position: 0 }),
      wireStep("s1", "filter", { combinator: "and", conditions: [] }, { position: 1 }),
      wireStep("s3", "compute", { column: "c", expression: "1" }, { position: 2 }),
    ]);
    await renderSpinePageSettled();
    await screen.findByRole("region", { name: "Step 1 Filter rows" });
    fireEvent.click(
      within(openRowMenu("Filter rows")).getByRole("menuitem", {
        name: "Move step down in Sales CSV",
      }),
    );
    expect(rowTitles()).toEqual(["Sort rows", "Filter rows", "Compute column"]);
    expect(reorderMock).toHaveBeenCalledWith("pipe-1", ["s2", "s1", "s3"]);
  });

  it("disables Move up on the first row and Move down on the last", async () => {
    await renderSpinePageSettled();
    await screen.findByRole("region", { name: "Step 1 Filter rows" });
    const first = openRowMenu("Filter rows");
    expect(
      within(first).getByRole("menuitem", { name: "Move step up in Sales CSV" }),
    ).toBeDisabled();
    fireEvent.keyDown(first, { key: "Escape" });
    const last = openRowMenu("Compute column");
    expect(
      within(last).getByRole("menuitem", { name: "Move step down in Sales CSV" }),
    ).toBeDisabled();
  });

  it("a failed reorder reverts to the previous order and surfaces an error toast", async () => {
    reorderMock.mockRejectedValueOnce(new Error("Conflict"));
    const store = makeSpineStore();
    await renderSpinePageSettled(store);
    await screen.findByRole("region", { name: "Step 1 Filter rows" });
    const menu = openRowMenu("Filter rows");
    await act(async () => {
      fireEvent.click(within(menu).getByRole("menuitem", { name: "Move step down in Sales CSV" }));
    });
    expect(rowTitles()).toEqual(["Filter rows", "Sort rows", "Compute column"]);
    expect(store.getState().toasts.items.at(-1)?.message).toMatch(/failed to reorder/i);
  });

  it("Remove deletes the step, selects its predecessor and shows the remaining rows", async () => {
    await renderSpinePageSettled();
    fireEvent.click(rowButton(3, "Compute column"));
    await screen.findByRole("region", { name: "Step 3 Compute column" });
    fireEvent.click(screen.getByRole("button", { name: "Remove step" }));
    expect(rowTitles()).toEqual(["Filter rows", "Sort rows"]);
    expect(await screen.findByRole("region", { name: "Step 2 Sort rows" })).toBeInTheDocument();
    expect(deleteMock).toHaveBeenCalledWith("s3");
    expect(rowButton(2, "Sort rows")).toHaveAttribute("aria-current", "true");
  });

  it("removing the first step selects the new first step", async () => {
    await renderSpinePageSettled();
    await screen.findByRole("region", { name: "Step 1 Filter rows" });
    fireEvent.click(screen.getByRole("button", { name: "Remove step" }));
    expect(await screen.findByRole("region", { name: "Step 1 Sort rows" })).toBeInTheDocument();
  });

  it("a failed delete restores the step and emits exactly one error toast with the full message", async () => {
    deleteMock.mockRejectedValueOnce(new Error("Conflict"));
    const store = makeSpineStore();
    await renderSpinePageSettled(store);
    await screen.findByRole("region", { name: "Step 1 Filter rows" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove step" }));
    });
    await waitFor(() => expect(rowTitles()).toHaveLength(3));
    const toasts = store.getState().toasts.items;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe("Failed to delete step: the request could not be completed.");
  });

  it("Disable persists via updatePipelineStepEnabled, mutes the row ('off') and flips the action to Enable", async () => {
    enabledMock.mockResolvedValueOnce(
      wireStep("s1", "filter", { combinator: "and", conditions: [] }, { enabled: false }),
    );
    await renderSpinePageSettled();
    await screen.findByRole("region", { name: "Step 1 Filter rows" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Disable step" }));
    });
    expect(enabledMock).toHaveBeenCalledWith("s1", false);
    expect(screen.getByRole("button", { name: "Enable step" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(rowButton(1, "Filter rows")).getByText("off")).toBeInTheDocument();
    // A disabled step has no preview to fetch: the table says why instead of 422-ing.
    expect(
      screen.getByText("This step is off, so rows pass through unchanged."),
    ).toBeInTheDocument();
  });

  it("a failed toggle reverts the optimistic flip and surfaces an error toast", async () => {
    enabledMock.mockRejectedValueOnce(new Error("Conflict"));
    const store = makeSpineStore();
    await renderSpinePageSettled(store);
    await screen.findByRole("region", { name: "Step 1 Filter rows" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Disable step" }));
    });
    expect(screen.getByRole("button", { name: "Disable step" })).toBeInTheDocument();
    expect(within(rowButton(1, "Filter rows")).queryByText("off")).not.toBeInTheDocument();
    expect(store.getState().toasts.items.at(-1)?.message).toMatch(/failed to disable step/i);
  });

  it("Duplicate resyncs from the server with the clone directly after the original, and selects it", async () => {
    const clone = wireStep("s1-clone", "filter", threeSteps()[0].config, {
      parentStepId: "s1",
      position: 0,
      rootId: undefined,
    });
    duplicateMock.mockResolvedValueOnce(clone);
    getStepsMock.mockResolvedValueOnce(threeSteps());
    await renderSpinePageSettled();
    await screen.findByRole("region", { name: "Step 1 Filter rows" });
    getStepsMock.mockResolvedValue([
      threeSteps()[0],
      clone,
      { ...threeSteps()[1], parentStepId: "s1-clone" } as PipelineStep,
      threeSteps()[2],
    ]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Duplicate step" }));
    });
    expect(duplicateMock).toHaveBeenCalledWith("s1");
    await waitFor(() =>
      expect(rowTitles()).toEqual(["Filter rows", "Filter rows", "Sort rows", "Compute column"]),
    );
    expect(await screen.findByRole("region", { name: "Step 2 Filter rows" })).toBeInTheDocument();
  });

  it("a rejected duplicate surfaces the server's message in an error toast and leaves the rows unchanged", async () => {
    duplicateMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 422, data: { message: "Step limit reached" } },
    });
    const store = makeSpineStore();
    await renderSpinePageSettled(store);
    await screen.findByRole("region", { name: "Step 1 Filter rows" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Duplicate step" }));
    });
    expect(rowTitles()).toEqual(["Filter rows", "Sort rows", "Compute column"]);
    expect(store.getState().toasts.items.at(-1)?.message).toContain("Step limit reached");
  });
});

describe("spine editing: save on selection change (design.md D7)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  /** Types a limit-style edit into the first step's editor: the filter value box. */
  async function editFilterValue(value: string) {
    const input = await screen.findByDisplayValue("180");
    fireEvent.change(input, { target: { value } });
  }

  async function settle() {
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("selecting another step right after an edit sends the pending PATCH with the edited config (nothing is lost)", async () => {
    await renderSpinePageSettled();
    await editFilterValue("240");
    expect(updateStepMock).not.toHaveBeenCalled(); // still inside the 400ms debounce window
    fireEvent.click(rowButton(2, "Sort rows"));
    await settle();
    expect(updateStepMock).toHaveBeenCalledTimes(1);
    expect(updateStepMock).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({
        conditions: [expect.objectContaining({ field: "duration_s", value: "240" })],
      }),
    );
  });

  it("re-selecting the edited step shows the saved value (editor and spine summary), and a later edit keeps it", async () => {
    await renderSpinePageSettled();
    await editFilterValue("240");
    fireEvent.click(rowButton(2, "Sort rows"));
    await settle();
    await settle();
    expect(updateStepMock).toHaveBeenCalledTimes(1);
    fireEvent.click(rowButton(1, "Filter rows"));
    expect(await screen.findByDisplayValue("240")).toBeInTheDocument();
    expect(within(spine()).getByText("duration_s ≥ 240")).toBeInTheDocument();
    // A later edit (the combinator) must carry the flushed value, not revert it to the pre-edit config.
    fireEvent.click(screen.getByRole("button", { name: /ANY/ }));
    await act(async () => {
      jest.advanceTimersByTime(450);
    });
    expect(updateStepMock).toHaveBeenCalledTimes(2);
    expect(updateStepMock.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        conditions: [expect.objectContaining({ value: "240" })],
      }),
    );
  });

  it("an edit followed by Remove sends no PATCH for the removed step", async () => {
    await renderSpinePageSettled();
    await editFilterValue("240");
    fireEvent.click(screen.getByRole("button", { name: "Remove step" }));
    await settle();
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(updateStepMock).not.toHaveBeenCalled();
    expect(deleteMock).toHaveBeenCalledWith("s1");
  });

  it("a flushed save that is rejected marks the row and shows the message when the step is selected again", async () => {
    updateStepMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 422, data: { message: "Operator not allowed" } },
    });
    await renderSpinePageSettled();
    await editFilterValue("240");
    fireEvent.click(rowButton(2, "Sort rows"));
    await settle();
    await settle();
    expect(
      within(spine()).getByRole("img", { name: "Couldn't save the last change to this step" }),
    ).toBeInTheDocument();
    // The marker sits inside the row button, whose aria-label overrides its content: the state is in the NAME too.
    expect(rowButton(1, "Filter rows")).toHaveAccessibleName(
      /couldn't save the last change to this step$/,
    );
    fireEvent.click(rowButton(1, "Filter rows"));
    expect(await screen.findByText("Operator not allowed")).toBeInTheDocument();
  });

  it("the debounced save itself still fires on its own after 400ms when the selection does not change", async () => {
    await renderSpinePageSettled();
    await editFilterValue("300");
    await act(async () => {
      jest.advanceTimersByTime(450);
    });
    expect(updateStepMock).toHaveBeenCalledTimes(1);
    expect(updateStepMock.mock.calls[0][0]).toBe("s1");
  });
});

describe("spine editing: preview freshness and ordering (design.md D8)", () => {
  it("re-selecting a step after an upstream edit fetches its preview again (no settled reuse)", async () => {
    await renderSpinePageSettled();
    fireEvent.click(rowButton(3, "Compute column"));
    await waitFor(() => expect(previewMock).toHaveBeenCalledWith("pipe-1", "s3"));
    const before = previewMock.mock.calls.filter(([, id]) => id === "s3").length;
    fireEvent.click(rowButton(1, "Filter rows"));
    fireEvent.change(await screen.findByDisplayValue("180"), { target: { value: "181" } });
    await waitFor(() => expect(updateStepMock).toHaveBeenCalledWith("s1", expect.anything()), {
      timeout: 2000,
    });
    fireEvent.click(rowButton(3, "Compute column"));
    await waitFor(() =>
      expect(previewMock.mock.calls.filter(([, id]) => id === "s3").length).toBeGreaterThan(before),
    );
  });

  it("the new selection's GET waits until the flushed PATCH of the previous step has resolved", async () => {
    let resolvePatch!: (s: PipelineStep) => void;
    updateStepMock.mockReturnValueOnce(
      new Promise<PipelineStep>((resolve) => {
        resolvePatch = resolve;
      }),
    );
    await renderSpinePageSettled();
    await waitFor(() => expect(previewMock).toHaveBeenCalledWith("pipe-1", "s1"));
    previewMock.mockClear();
    fireEvent.change(await screen.findByDisplayValue("180"), { target: { value: "181" } });
    fireEvent.click(rowButton(2, "Sort rows")); // unmounts the editor: the pending edit is flushed immediately
    await waitFor(() => expect(updateStepMock).toHaveBeenCalledWith("s1", expect.anything()));
    // Give the table's own effect every chance to fetch early.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(previewMock).not.toHaveBeenCalled();
    expect(screen.getByRole("status", { name: "Loading preview" })).toBeInTheDocument();
    await act(async () => {
      resolvePatch(wireStep("s1", "filter", { combinator: "and", conditions: [] }));
    });
    await waitFor(() => expect(previewMock).toHaveBeenCalledWith("pipe-1", "s2"));
  });

  it("issues exactly one step-preview GET for the initially selected step on open, also under StrictMode", async () => {
    await renderSpinePageSettled(makeSpineStore(), "/pipelines/pipe-1", true);
    await screen.findByText("1 row");
    expect(previewMock.mock.calls.filter(([, id]) => id === "s1")).toHaveLength(1);
    expect(previewMock).toHaveBeenCalledTimes(1);
  });

  it("shows the preview error in place and the named step-configuration reason for a 422", async () => {
    previewMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 422,
        data: {
          message: "bad",
          code: "STEP_CONFIG_INVALID",
          reason: "Filter value is not a number",
        },
      },
    });
    await renderSpinePageSettled();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("shows 'No rows to preview.' for an empty result", async () => {
    previewMock.mockResolvedValue({ rows: [], rowCount: 0 });
    await renderSpinePageSettled();
    expect(await screen.findByText("No rows to preview.")).toBeInTheDocument();
  });

  it("shows each column's data type from the analyze output schema in the header", async () => {
    previewMock.mockResolvedValue({
      rows: [{ date: "2026-09-14", status: "ok", duration_s: 5 }],
      rowCount: 1,
    });
    await renderSpinePageSettled();
    const table = await screen.findByRole("table");
    expect(within(table).getByText("duration_s")).toBeInTheDocument();
    expect(within(table).getByText("integer")).toBeInTheDocument();
  });

  it("moves the schema chips here from the footer: output-schema chips in the table header", async () => {
    await renderSpinePageSettled();
    const header = (await screen.findByRole("region", { name: "Rows after step 1" })).querySelector(
      ".step-preview__header",
    ) as HTMLElement;
    expect(within(header).getByLabelText("Output schema")).toHaveTextContent(
      "datestatusduration_s",
    );
  });
});

describe("spine editing: steps loading and failure", () => {
  it("shows the steps error with Retry (not the empty editor) when the steps fetch rejects, then recovers", async () => {
    getStepsMock.mockRejectedValueOnce(new Error("boom"));
    await renderSpinePageSettled();
    expect(await screen.findByText("Couldn't load this pipeline's steps.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Add step" })).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ steps?$/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      await within(spine()).findByRole("button", { name: /^Step 1: Filter rows/ }),
    ).toBeInTheDocument();
  });
});

describe("spine editing: the creating-step guard (HEL-1294)", () => {
  it("shows a step still being created as a draft row with a disabled editor and no preview request", async () => {
    createMock.mockReturnValueOnce(new Promise<never>(() => {}));
    await renderSpinePageSettled();
    await screen.findByRole("region", { name: "Step 1 Filter rows" });
    fireEvent.click(within(spine()).getByRole("button", { name: "+ Add transformation step" }));
    await pickFromPalette(/Limit rows/i);
    const editor = await screen.findByRole("region", { name: "Step 4 Limit rows" });
    expect(within(editor).getByRole("status")).toHaveTextContent("Saving step…");
    expect(editor.querySelector("fieldset")).toBeDisabled();
    expect(screen.getByText(/Saving step… rows appear once it is saved\./)).toBeInTheDocument();
    expect(previewMock.mock.calls.filter(([, id]) => String(id).startsWith("step-"))).toHaveLength(
      0,
    );
  });
});

describe("spine editing: run and dry run", () => {
  it("Run pipeline and Dry run call the run API", async () => {
    await renderSpinePageSettled();
    await screen.findByRole("region", { name: "Step 1 Filter rows" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run pipeline" }));
    });
    expect(runMock).toHaveBeenCalledWith("pipe-1", undefined);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dry run" }));
    });
    expect(runMock).toHaveBeenLastCalledWith("pipe-1", true);
  });
});

describe("spine editing: step config editors through the focused editor", () => {
  const renameStep = wireStep("r1", "rename", { renames: { dept: "dept", name: "full_name" } });
  const selectStep = wireStep(
    "sel1",
    "select",
    { fields: ["date"] },
    { parentStepId: "r1", position: 0, rootId: undefined },
  );

  beforeEach(() => {
    jest.mocked(getPipelineSteps).mockResolvedValue([renameStep]);
    analyzeMock.mockResolvedValue({
      ...analyzeFor([renameStep]),
      steps: [
        {
          id: "r1",
          position: 0,
          type: "rename",
          config: renameStep.config,
          inputSchema: [
            { name: "dept", type: "string" },
            { name: "name", type: "string" },
          ],
          outputSchema: [
            { name: "dept", type: "string" },
            { name: "full_name", type: "string" },
          ],
        },
      ] as never,
    });
  });

  it("hydrates a rename editor's inputs from the persisted config and PATCHes a changed name after the debounce", async () => {
    await renderSpinePageSettled();
    const box = await screen.findByRole("textbox", { name: "New name for name" });
    expect(box).toHaveValue("full_name");
    fireEvent.change(screen.getByRole("textbox", { name: "New name for dept" }), {
      target: { value: "department" },
    });
    await waitFor(() =>
      expect(updateStepMock).toHaveBeenCalledWith(
        "r1",
        expect.objectContaining({ renames: expect.objectContaining({ dept: "department" }) }),
      ),
    );
  });

  it("clearing a rename input removes the field key from the persisted config", async () => {
    await renderSpinePageSettled();
    fireEvent.change(await screen.findByRole("textbox", { name: "New name for name" }), {
      target: { value: "" },
    });
    await waitFor(() => expect(updateStepMock).toHaveBeenCalled());
    const config = updateStepMock.mock.calls.at(-1)![1] as { renames: Record<string, string> };
    expect(config.renames).not.toHaveProperty("name");
  });

  it("restores a select step's previously selected fields when its row is selected", async () => {
    jest.mocked(getPipelineSteps).mockResolvedValue([renameStep, selectStep]);
    analyzeMock.mockResolvedValue({
      ...analyzeFor([renameStep, selectStep]),
      steps: [
        {
          id: "r1",
          position: 0,
          type: "rename",
          config: renameStep.config,
          inputSchema: [{ name: "date", type: "string" }],
          outputSchema: [{ name: "date", type: "string" }],
        },
        {
          id: "sel1",
          position: 1,
          type: "select",
          config: selectStep.config,
          inputSchema: [
            { name: "date", type: "string" },
            { name: "status", type: "string" },
          ],
          outputSchema: [{ name: "date", type: "string" }],
        },
      ] as never,
    });
    await renderSpinePageSettled();
    fireEvent.click(await within(spine()).findByRole("button", { name: /^Step 2: Select fields/ }));
    expect(await screen.findByRole("checkbox", { name: "date" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "status" })).not.toBeChecked();
  });
});

describe("spine editing: structural changes re-run the debounced analyze", () => {
  it("a reorder, an enable toggle and an insert each change the steps fingerprint and re-dispatch analyze", async () => {
    reorderMock.mockResolvedValue([]);
    enabledMock.mockResolvedValue(wireStep("s1", "filter", { combinator: "and", conditions: [] }));
    await renderSpinePageSettled();
    await screen.findByRole("region", { name: "Step 1 Filter rows" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    const dispatched = (): number => analyzeMock.mock.calls.length;
    const baseline = dispatched();
    const menu = openRowMenu("Filter rows");
    await act(async () => {
      fireEvent.click(within(menu).getByRole("menuitem", { name: "Move step down in Sales CSV" }));
    });
    await waitFor(() => expect(dispatched()).toBeGreaterThan(baseline), { timeout: 2000 });

    const afterReorder = dispatched();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Disable step" }));
    });
    await waitFor(() => expect(dispatched()).toBeGreaterThan(afterReorder), { timeout: 2000 });
  });
});
