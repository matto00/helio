// HEL-1794 (design.md D3/D4): the phone pipeline page offers a viewer no edit affordance, including in the step sheet.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

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
import { installPhoneShell } from "../pipelineDetailPageTestUtils";
import { stubDialogMethods } from "../pipelineMobileTestKit";
import {
  SPINE_PIPELINE,
  analyzeFor,
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

let restorePhone: () => void;
beforeAll(() => stubDialogMethods());
beforeEach(() => {
  restorePhone = installPhoneShell();
  jest.mocked(httpClient.get).mockResolvedValue({ data: { rows: [], rowCount: 0 } });
  jest.mocked(fetchRunHistory).mockResolvedValue([]);
  jest.mocked(getPipelineById).mockResolvedValue(SPINE_PIPELINE);
  jest.mocked(getPipelineStepCatalog).mockResolvedValue({ groups: [], steps: [] });
  jest.mocked(getPipelineSteps).mockResolvedValue(threeSteps());
  jest.mocked(fetchStepPreview).mockResolvedValue({ rows: [], rowCount: 0 });
  jest
    .mocked(getPipelineSchedule)
    .mockRejectedValue({ isAxiosError: true, response: { status: 404 } });
});
afterEach(() => {
  restorePhone();
  jest.clearAllMocks();
});

function analyzeAs(callerRole: PipelineCallerRole) {
  jest.mocked(analyzePipeline).mockResolvedValue(analyzeFor(threeSteps(), { callerRole }));
}
const q = (name: string | RegExp) => screen.queryByRole("button", { name });

describe("phone edit affordances by caller role", () => {
  it("a viewer: no menu, no schedule chip, no add/new controls, and a read-only step sheet", async () => {
    analyzeAs("viewer");
    await renderSpinePageSettled();
    expect(await screen.findByText("View only")).toBeVisible();
    for (const name of [
      "Pipeline actions",
      "Add schedule",
      "Add source",
      "+ Add transformation step",
      "New output",
      /^Step actions for/,
    ]) {
      expect(q(name)).toBeNull();
    }
    expect(document.querySelector(".spine-row__menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Step 1:/ }));
    const sheet = screen.getByRole("dialog", { name: "Step details" });
    expect(within(sheet).queryByRole("button", { name: /^Step actions for/ })).toBeNull();
    for (const name of ["Disable step", "Duplicate step", "Remove step"]) {
      expect(within(sheet).queryByRole("button", { name })).toBeNull();
    }
    expect((sheet.querySelector(".step-focused__fieldset") as HTMLFieldSetElement).disabled).toBe(
      true,
    );
    expect(within(sheet).getByText("Step")).toBeVisible();
    expect(within(sheet).queryByText("Edit step")).toBeNull();
  });

  it("a viewer cannot create a draft from the sheet's fields", async () => {
    analyzeAs("viewer");
    await renderSpinePageSettled();
    await screen.findByText("View only");
    fireEvent.click(screen.getByRole("button", { name: /^Step 1:/ }));
    const sheet = screen.getByRole("dialog");
    expect(sheet.querySelector(".step-focused__fieldset")).not.toBeNull();
    fireEvent.change(sheet.querySelector(".step-focused__fieldset input") as HTMLInputElement, {
      target: { value: "999" },
    });
    expect(q("Discard draft")).toBeNull();
    expect(screen.queryByText("Discard")).toBeNull();
  });

  it("an editor keeps the menu entries, the add controls and an editable sheet", async () => {
    analyzeAs("editor");
    await renderSpinePageSettled();
    await waitFor(() => expect(q("Pipeline actions")).not.toBeNull());
    expect(q("+ Add transformation step")).not.toBeNull();
    expect(q("New output")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Step 1:/ }));
    const sheet = screen.getByRole("dialog", { name: "Step editor" });
    expect(within(sheet).getByRole("button", { name: /^Step actions for/ })).toBeVisible();
    expect((sheet.querySelector(".step-focused__fieldset") as HTMLFieldSetElement).disabled).toBe(
      false,
    );
  });
});

describe("phone Preview tab with no steps (HEL-1794)", () => {
  it.each([
    ["viewer", "This pipeline has no steps yet."],
    ["editor", "Add a step on the Steps tab to see the rows it produces."],
  ] as const)("a %s reads the right empty state", async (role, text) => {
    jest.mocked(getPipelineSteps).mockResolvedValue([]);
    analyzeAs(role);
    await renderSpinePageSettled();
    await waitFor(() => expect(screen.getByRole("tab", { name: "Preview" })).toBeVisible());
    fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
    expect(await screen.findByText(text)).toBeVisible();
  });
});
