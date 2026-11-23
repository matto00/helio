// HEL-1794 (design.md D3/D4): the desktop pipeline page offers NO edit affordance to a viewer (or while the role is unknown), shows
// the configuration read-only, swaps the invitation copy, and never creates a draft; an editor and the owner keep every control.

import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import { httpClient } from "../../../../services/httpClient";
import {
  analyzePipeline,
  fetchRunHistory,
  fetchStepPreview,
  getPipelineById,
  getPipelineSchedule,
  getPipelineStepCatalog,
  getPipelineSteps,
} from "../../services/pipelineService";
import type { PipelineCallerRole } from "../../types/pipelineStep";
import {
  SPINE_PIPELINE,
  analyzeFor,
  makeOutput,
  makeSpineStore,
  renderSpinePageSettled,
  threeSteps,
} from "../pipelineSpineTestKit";

jest.mock("../../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("../../../sources/services/dataSourceService", () => ({
  ...jest.requireActual("../../../sources/services/dataSourceService"),
  fetchSources: jest.fn(() =>
    Promise.reject(new Error("fetchSources: unmocked request stubbed (HEL-1600)")),
  ),
}));
jest.mock("../../services/pipelineService", () => ({
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

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

beforeEach(() => {
  jest.mocked(httpClient.get).mockImplementation((url: string) =>
    Promise.resolve({
      data: url.endsWith("/panels")
        ? []
        : { columns: [], capabilities: {}, rows: [], rowCount: 0, materialized: false },
    }),
  );
  jest.mocked(fetchRunHistory).mockResolvedValue([]);
  jest.mocked(getPipelineById).mockResolvedValue(SPINE_PIPELINE);
  jest.mocked(getPipelineStepCatalog).mockResolvedValue({ groups: [], steps: [] });
  jest
    .mocked(getPipelineSchedule)
    .mockRejectedValue({ isAxiosError: true, response: { status: 404 } });
  jest.mocked(getPipelineSteps).mockResolvedValue(threeSteps());
  jest.mocked(fetchStepPreview).mockResolvedValue({ rows: [], rowCount: 0 });
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

function analyzeAs(callerRole: PipelineCallerRole) {
  jest.mocked(analyzePipeline).mockResolvedValue(analyzeFor(threeSteps(), { callerRole }));
}

const q = (name: string | RegExp) => screen.queryByRole("button", { name });
const EDIT_CONTROLS: Array<string | RegExp> = [
  "Edit pipeline name",
  "Add schedule",
  "Add source",
  "+ Add transformation step",
  "New output",
  /^Step actions for/,
];

describe("desktop edit affordances by caller role", () => {
  it("a viewer sees no edit control on the page, in the step editor or in the actions menu", async () => {
    analyzeAs("viewer");
    await renderSpinePageSettled(makeSpineStore({ outputs: [makeOutput("o1", "Out one")] }));
    expect(await screen.findByText("View only")).toBeVisible();
    for (const name of EDIT_CONTROLS) expect(q(name)).toBeNull();
    expect(document.querySelector(".spine-row__menu")).toBeNull();
    expect(document.querySelector(".spine-row__grip")).toBeNull();
    expect(document.querySelector('[draggable="true"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Step 1:/ }));
    for (const name of ["Disable step", "Duplicate step", "Remove step"])
      expect(q(name)).toBeNull();
    const fieldset = document.querySelector(".step-focused__fieldset") as HTMLFieldSetElement;
    expect(fieldset.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Pipeline actions" }));
    expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /schedule/i })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Run history" })).toBeVisible();
  });

  it("a viewer cannot create a draft: a change event on a configuration field records nothing", async () => {
    analyzeAs("viewer");
    await renderSpinePageSettled();
    await screen.findByText("View only");
    fireEvent.click(screen.getByRole("button", { name: /^Step 1:/ }));
    const field = document.querySelector(".step-focused__fieldset input") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "999" } });
    expect(q("Discard draft")).toBeNull();
    expect(screen.queryByText("Draft · unsaved changes")).toBeNull();
    expect(
      Object.keys(window.sessionStorage).filter((k) => k.startsWith("helio.pipelineDraft.")),
    ).toEqual([]);
  });

  it("while the role is unknown (pending) no edit control is offered either", async () => {
    jest.mocked(analyzePipeline).mockReturnValue(new Promise(() => {}));
    await renderSpinePageSettled();
    for (const name of EDIT_CONTROLS) expect(q(name)).toBeNull();
  });

  it("an editor keeps every edit control and the step fields are enabled", async () => {
    analyzeAs("editor");
    await renderSpinePageSettled(makeSpineStore({ outputs: [makeOutput("o1", "Out one")] }));
    await waitFor(() => expect(q("Add source")).not.toBeNull());
    for (const name of EDIT_CONTROLS.filter((n) => !(n instanceof RegExp))) {
      expect(q(name)).not.toBeNull();
    }
    expect(screen.getAllByRole("button", { name: /^Step actions for/ }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /^Step 1:/ }));
    expect(q("Remove step")).not.toBeNull();
    expect(
      (document.querySelector(".step-focused__fieldset") as HTMLFieldSetElement).disabled,
    ).toBe(false);
  });

  it("the owner keeps every edit control at once", async () => {
    jest.mocked(analyzePipeline).mockReturnValue(new Promise(() => {}));
    const pipeline = { ...SPINE_PIPELINE, ownerId: "u-1" };
    jest.mocked(getPipelineById).mockResolvedValue(pipeline);
    await renderSpinePageSettled(makeSpineStore({ pipeline, currentUserId: "u-1" }));
    expect(q("Edit pipeline name")).not.toBeNull();
    expect(q("Add source")).not.toBeNull();
    expect(q("New output")).not.toBeNull();
  });
});

describe("desktop viewer copy", () => {
  it("an empty pipeline says nothing that invites an edit to a viewer, and still does to an editor", async () => {
    jest.mocked(getPipelineSteps).mockResolvedValue([]);
    analyzeAs("viewer");
    await renderSpinePageSettled();
    await screen.findByText("View only");
    expect(await screen.findByText("No transformation steps yet.")).toBeVisible();
    expect(screen.getByText("This pipeline has no steps.")).toBeVisible();
    expect(screen.queryByText(/Add your first transformation step/)).toBeNull();
    expect(screen.queryByText("Nothing to edit yet")).toBeNull();
    expect(screen.getByRole("region", { name: "Step details and preview" })).toBeVisible();
    cleanup();
    analyzeAs("editor");
    await renderSpinePageSettled();
    expect(await screen.findByText(/Add your first transformation step/)).toBeVisible();
    expect(screen.getByRole("region", { name: "Step editor and preview" })).toBeVisible();
  });
});

describe("a viewer opening an Output", () => {
  it("sees the preview with disabled fields, no Save/Delete, a Close button, and no 'Edit' title", async () => {
    analyzeAs("viewer");
    await renderSpinePageSettled(makeSpineStore({ outputs: [makeOutput("o1", "Out one")] }));
    await screen.findByText("View only");
    fireEvent.click(screen.getByRole("button", { name: "Open Out one output" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: "Save" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Delete" })).toBeNull();
    expect(within(dialog).getByRole("textbox", { name: "Name" })).toBeDisabled();
    expect(within(dialog).getAllByRole("button", { name: "Close" }).length).toBeGreaterThan(0);
    expect(dialog.querySelector(".ui-modal__title")?.textContent).toBe("Out one");
    expect(
      await within(dialog).findByText(
        "This Output has no rows yet. It fills in after the pipeline's next run.",
      ),
    ).toBeVisible();
    expect(within(dialog).queryByText(/Run the pipeline to populate it/)).toBeNull();
  });
});
