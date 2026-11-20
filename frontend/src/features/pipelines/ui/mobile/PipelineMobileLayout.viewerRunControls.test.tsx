// HEL-1661 (design.md D4/D5): the phone pipeline page for a viewer: no run pills, "View only" in the header, and no empty
// reserved bar (the clearance variable is never published, so the tab body keeps its no-bar bottom padding).
import { screen } from "@testing-library/react";

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
import { ACTIONS_HEIGHT_PROPERTY } from "./MobilePipelineActions";

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

describe("phone run pills by caller role", () => {
  it("a viewer has no Dry run or Run pipeline pill, no action bar, and the header says View only", async () => {
    analyzeAs("viewer");
    await renderSpinePageSettled();
    expect(await screen.findByText("View only")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Dry run" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Run pipeline" })).toBeNull();
    expect(document.querySelector(".mobile-actions")).toBeNull();
    const page = document.querySelector(".pipeline-detail-page--mobile") as HTMLElement;
    expect(page.style.getPropertyValue(ACTIONS_HEIGHT_PROPERTY)).toBe("");
  });

  it("an editor keeps both pills and sees no indicator", async () => {
    analyzeAs("editor");
    await renderSpinePageSettled();
    expect(screen.getByRole("button", { name: "Dry run" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Run pipeline" })).toBeEnabled();
    expect(screen.queryByText("View only")).toBeNull();
  });
});
