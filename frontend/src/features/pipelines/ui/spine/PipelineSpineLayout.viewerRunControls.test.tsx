// HEL-1661 (design.md D4/D5): the desktop pipeline page shows a run entry only to a caller who can run, and says "View only" to
// a viewer. The role is the last analyze result's `callerRole` (the owner is known from the pipeline row at once).

import { cleanup, fireEvent, screen, within } from "@testing-library/react";

import { httpClient } from "../../../../services/httpClient";
import {
  analyzePipeline,
  fetchRunHistory,
  fetchStepPreview,
  getPipelineById,
  getPipelineSchedule,
  getPipelineStepCatalog,
  getPipelineSteps,
  runPipeline,
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

const runButton = () => screen.queryByRole("button", { name: "Run pipeline" });
const dryButton = () => screen.queryByRole("button", { name: "Dry run" });

describe("desktop run controls by caller role", () => {
  it("a viewer sees no Run pipeline or Dry run, and the header says View only", async () => {
    analyzeAs("viewer");
    await renderSpinePageSettled();
    expect(await screen.findByText("View only")).toBeVisible();
    expect(runButton()).toBeNull();
    expect(dryButton()).toBeNull();
    expect(screen.getByRole("button", { name: "Pipeline actions" })).toBeVisible();
  });

  it("an editor keeps Run pipeline and Dry run, enabled, and sees no indicator", async () => {
    analyzeAs("editor");
    await renderSpinePageSettled();
    expect(runButton()).toBeEnabled();
    expect(dryButton()).toBeEnabled();
    expect(screen.queryByText("View only")).toBeNull();
  });

  it("the owner is known from the pipeline row at once: controls show even while analyze is still pending", async () => {
    jest.mocked(analyzePipeline).mockReturnValue(new Promise(() => {}));
    const pipeline = { ...SPINE_PIPELINE, ownerId: "u-1" };
    jest.mocked(getPipelineById).mockResolvedValue(pipeline);
    await renderSpinePageSettled(makeSpineStore({ pipeline, currentUserId: "u-1" }));
    expect(runButton()).toBeEnabled();
    expect(dryButton()).toBeEnabled();
  });

  it("while the role is unknown (analyze pending, not the owner) no run entry shows and nothing says View only", async () => {
    jest.mocked(analyzePipeline).mockReturnValue(new Promise(() => {}));
    await renderSpinePageSettled();
    expect(runButton()).toBeNull();
    expect(dryButton()).toBeNull();
    expect(screen.queryByText("View only")).toBeNull();
    expect(document.querySelector('[data-run-slot="pending"]')).not.toBeNull();
  });

  it("when analyze failed with no result ever, the controls show (the server stays the authority)", async () => {
    jest.mocked(analyzePipeline).mockRejectedValue(new Error("boom"));
    await renderSpinePageSettled();
    expect(runButton()).toBeEnabled();
    expect(screen.queryByText("View only")).toBeNull();
  });

  it("a viewer opening a never-run Output sheet is offered no Run pipeline there; an editor is", async () => {
    for (const [role, expected] of [
      ["viewer", 0],
      ["editor", 1],
    ] as const) {
      analyzeAs(role);
      const store = makeSpineStore({ outputs: [makeOutput("o1", "Out one")] });
      await renderSpinePageSettled(store);
      fireEvent.click(screen.getByRole("button", { name: "Open Out one output" }));
      const dialog = await screen.findByRole("dialog");
      // HEL-1794: the viewer's paragraph no longer invites a run; the editor's keeps the "Run the pipeline" line.
      expect(
        await within(dialog).findByText(
          role === "viewer"
            ? /This Output has no rows yet/
            : /hasn.t been included in a saved run yet/,
        ),
      ).toBeVisible();
      expect(within(dialog).queryAllByRole("button", { name: "Run pipeline" })).toHaveLength(
        expected,
      );
      cleanup();
    }
    expect(runPipeline).not.toHaveBeenCalled();
  });
});
