// HEL-1685 (item C): the live Output column is memoised, so the `onToggle` the layout hands it must keep its identity across
// a draft edit; a new function every render would re-render the column on every edit.

import { cleanup, fireEvent, screen } from "@testing-library/react";

import {
  analyzePipeline,
  fetchRunHistory,
  fetchStepPreview,
  getPipelineById,
  getPipelineSchedule,
  getPipelineStepCatalog,
  getPipelineSteps,
} from "../../services/pipelineService";
import { getPipelineWithDefinition } from "../../services/draftSaveService";
import { httpClient } from "../../../../services/httpClient";
import type { SourceSample } from "../../../sources/types/dataSource";
import {
  SPINE_PIPELINE,
  analyzeFor,
  makeSpineStore,
  renderSpinePageSettled,
  threeSteps,
} from "../pipelineSpineTestKit";

const mockToggles: unknown[] = [];
jest.mock("../liveOutput/LiveOutputColumn", () => ({
  LiveOutputColumn: (props: { onToggle?: unknown }) => {
    mockToggles.push(props.onToggle);
    return null;
  },
}));

jest.mock("../../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
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

jest.mock("../../services/outputService", () => ({
  ...jest.requireActual("../../services/outputService"),
  previewOutputs: jest.fn(),
}));

jest.mock("../../services/draftSaveService", () => ({
  ...jest.requireActual("../../services/draftSaveService"),
  getPipelineWithDefinition: jest.fn(),
  saveDraft: jest.fn(),
}));

jest.mock("../../../patchSets/services/patchSetService", () => ({
  undoPatchSet: jest.fn(),
}));

const DURATIONS = [100, 150, 180, 200, 250, 300];
const SAMPLE: SourceSample = {
  rows: DURATIONS.map((d, i) => ({ date: `2026-09-0${i + 1}`, status: "ok", duration_s: d })),
  capturedAt: "2026-10-19T00:00:00Z",
  sourceRowCount: DURATIONS.length,
  truncated: false,
  live: false,
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
  mockToggles.length = 0;
  jest.mocked(httpClient.get).mockResolvedValue({ data: { columns: [], capabilities: {} } });
  jest.mocked(fetchRunHistory).mockResolvedValue([]);
  jest.mocked(getPipelineById).mockResolvedValue(SPINE_PIPELINE);
  jest.mocked(getPipelineStepCatalog).mockResolvedValue({ groups: [], steps: [] });
  jest
    .mocked(getPipelineSchedule)
    .mockRejectedValue({ isAxiosError: true, response: { status: 404 } });
  jest.mocked(getPipelineSteps).mockResolvedValue(threeSteps());
  jest.mocked(analyzePipeline).mockResolvedValue(analyzeFor(threeSteps()));
  jest.mocked(fetchStepPreview).mockResolvedValue({ rows: [{ date: "2026-09-14" }], rowCount: 1 });
  jest.mocked(getPipelineWithDefinition).mockResolvedValue({
    ...SPINE_PIPELINE,
    fingerprint: "v1:" + "a".repeat(64),
  } as never);
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe("PipelineSpineLayout passes the live Output column a stable onToggle (HEL-1685 item C)", () => {
  it("keeps one onToggle identity across a draft edit", async () => {
    await renderSpinePageSettled(makeSpineStore({ samples: { "src-1": SAMPLE }, outputs: [] }));
    await screen.findByRole("region", { name: "Step 1 Filter rows" });
    const rendersBefore = mockToggles.length;

    fireEvent.change(screen.getByDisplayValue("180"), { target: { value: "240" } });
    expect(screen.getByText("Draft · unsaved changes")).toBeInTheDocument();

    expect(mockToggles.length).toBeGreaterThan(rendersBefore);
    expect(new Set(mockToggles).size).toBe(1);
  });
});
