// HEL-1837: read all, owner writes, on the phone pipeline page (header chip row and the Pipeline actions menu).
import { fireEvent, screen, waitFor } from "@testing-library/react";

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
import type { PipelineSchedule } from "../../types/pipelineSchedule";
import type { PipelineCallerRole } from "../../types/pipelineStep";
import { installPhoneShell } from "../pipelineDetailPageTestUtils";
import { stubDialogMethods } from "../pipelineMobileTestKit";
import {
  SPINE_PIPELINE,
  analyzeFor,
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

let restorePhone: () => void;
beforeAll(() => stubDialogMethods());

const SCHEDULE: PipelineSchedule = {
  id: "sch-1",
  pipelineId: "pipe-1",
  kind: "cron",
  expression: "0 9 * * 1-5",
  enabled: true,
  timezone: "UTC",
  nextRunAt: null,
  lastRunAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  restorePhone = installPhoneShell();
  jest.mocked(httpClient.get).mockImplementation((url: string) =>
    Promise.resolve({
      data: url.endsWith("/panels")
        ? []
        : { columns: [], capabilities: {}, rows: [], rowCount: 0, materialized: false },
    }),
  );
  jest.mocked(fetchRunHistory).mockResolvedValue([]);
  jest.mocked(getPipelineStepCatalog).mockResolvedValue({ groups: [], steps: [] });
  jest.mocked(getPipelineSteps).mockResolvedValue(threeSteps());
  jest.mocked(fetchStepPreview).mockResolvedValue({ rows: [], rowCount: 0 });
});
afterEach(() => {
  restorePhone();
  jest.clearAllMocks();
});

function setup(
  role: PipelineCallerRole,
  who: "owner" | "grantee",
  schedule: PipelineSchedule | null,
) {
  const pipeline = { ...SPINE_PIPELINE, ownerId: "u-owner" };
  jest.mocked(getPipelineById).mockResolvedValue(pipeline);
  jest.mocked(analyzePipeline).mockResolvedValue(analyzeFor(threeSteps(), { callerRole: role }));
  if (schedule === null) {
    jest
      .mocked(getPipelineSchedule)
      .mockRejectedValue({ isAxiosError: true, response: { status: 404 } });
  } else {
    jest.mocked(getPipelineSchedule).mockResolvedValue(schedule);
  }
  return makeSpineStore({ pipeline, currentUserId: who === "owner" ? "u-owner" : "u-grantee" });
}

const chip = () => document.querySelector(".spine-header__chip");
const scheduleButtons = () => screen.queryAllByRole("button", { name: /schedule/i });

describe("phone schedule chip by role (HEL-1837: read all, owner writes)", () => {
  it.each(["editor", "viewer"] as const)(
    "a %s grantee sees a read-only chip (not a button) and no schedule write control",
    async (role) => {
      await renderSpinePageSettled(setup(role, "grantee", SCHEDULE));
      await waitFor(() => expect(screen.getByText("0 9 * * 1-5")).toBeVisible());
      const el = chip() as HTMLElement;
      expect(el.tagName).not.toBe("BUTTON");
      expect(el.closest("button")).toBeNull();
      expect(el.getAttribute("tabindex")).toBeNull();
      expect(scheduleButtons()).toHaveLength(0);
      const menu = screen.queryByRole("button", { name: "Pipeline actions" });
      if (menu) fireEvent.click(menu);
      expect(screen.queryByRole("menuitem", { name: /schedule/i })).toBeNull();
    },
  );

  it.each(["editor", "viewer"] as const)(
    "a %s grantee of a pipeline with no schedule sees no chip and no Add schedule",
    async (role) => {
      await renderSpinePageSettled(setup(role, "grantee", null));
      await waitFor(() => expect(getPipelineSchedule).toHaveBeenCalled());
      await screen.findByText("Revenue rollup");
      expect(chip()).toBeNull();
      expect(scheduleButtons()).toHaveLength(0);
      const menu = screen.queryByRole("button", { name: "Pipeline actions" });
      if (menu) fireEvent.click(menu);
      expect(screen.queryByRole("menuitem", { name: /schedule/i })).toBeNull();
    },
  );

  it("a paused schedule shows the Paused marker read-only to a viewer", async () => {
    await renderSpinePageSettled(setup("viewer", "grantee", { ...SCHEDULE, enabled: false }));
    await waitFor(() => expect(screen.getByText("Paused")).toBeVisible());
    expect((chip() as HTMLElement).tagName).not.toBe("BUTTON");
  });

  it("the owner still gets the interactive chip that opens the dialog", async () => {
    await renderSpinePageSettled(setup("editor", "owner", SCHEDULE));
    const button = await screen.findByRole("button", { name: "Edit schedule" });
    fireEvent.click(button);
    expect(await screen.findByRole("dialog", { name: /schedule/i })).toBeInTheDocument();
  });

  it("the owner with no schedule still gets Add schedule", async () => {
    await renderSpinePageSettled(setup("editor", "owner", null));
    expect(await screen.findByRole("button", { name: "Add schedule" })).toBeVisible();
  });

  it("while ownership is unknown (no signed-in user) the chip is read-only", async () => {
    const pipeline = { ...SPINE_PIPELINE, ownerId: "u-owner" };
    setup("editor", "grantee", SCHEDULE);
    await renderSpinePageSettled(makeSpineStore({ pipeline }));
    await waitFor(() => expect(screen.getByText("0 9 * * 1-5")).toBeVisible());
    expect(scheduleButtons()).toHaveLength(0);
  });
});
