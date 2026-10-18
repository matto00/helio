// HEL-1579: the desktop pipeline page as a step spine -- structure, selection, per-step row counts (persisted vs in-session
// vs "—"), lanes, outputs section and the header. jsdom has no `matchMedia`, so `useIsPhoneShell()` is false and the page
// renders its desktop layout; the phone-path test at the bottom stubs the phone query. Assertions that used to target the
// footer / tabs / river on desktop live here at their new locations (see the change's `test-migration.md`).
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import {
  analyzePipeline,
  fetchRunHistory,
  fetchStepPreview,
  getPipelineById,
  getPipelineSchedule,
  getPipelineStepCatalog,
  getPipelineSteps,
  putPipelineSchedule,
  updatePipeline,
} from "../services/pipelineService";
import { httpClient } from "../../../services/httpClient";
import type { PipelineSchedule } from "../types/pipelineSchedule";
import type { PipelineStep } from "../types/pipelineStep";
import { installPhoneShell } from "./pipelineDetailPageTestUtils";
import {
  SPINE_PIPELINE,
  analyzeFor,
  makeOutput,
  makeSpineStore,
  renderSpinePageSettled,
  threeSteps,
  wireStep,
} from "./pipelineSpineTestKit";

// The Output editor sheet and its History view read through `httpClient`; nothing in this file asserts on them.
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
const scheduleMock = jest.mocked(getPipelineSchedule);
const putScheduleMock = jest.mocked(putPipelineSchedule);
const updatePipelineMock = jest.mocked(updatePipeline);

function notFound() {
  return { isAxiosError: true, response: { status: 404 } };
}

function schedule(partial: Partial<PipelineSchedule> = {}): PipelineSchedule {
  return {
    id: "sch-1",
    pipelineId: "pipe-1",
    kind: "cron",
    expression: "0 6 * * *",
    enabled: true,
    timezone: "UTC",
    nextRunAt: null,
    lastRunAt: null,
    createdAt: "",
    updatedAt: "",
    ...partial,
  };
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

beforeEach(() => {
  jest.mocked(httpClient.get).mockImplementation((url: string) => {
    if (url.endsWith("/panels")) return Promise.resolve({ data: [] });
    if (url.includes("/capabilities")) {
      return Promise.resolve({ data: { columns: [], capabilities: {} } });
    }
    return Promise.resolve({
      data: {
        rows: [],
        rowCount: 0,
        stepRowCounts: {},
        sourceRowCount: 0,
        blocked: false,
        sourceTruncated: false,
        truncatedReads: [],
      },
    });
  });
  jest.mocked(fetchRunHistory).mockResolvedValue([]);
  jest.mocked(getPipelineById).mockResolvedValue(SPINE_PIPELINE);
  jest.mocked(getPipelineStepCatalog).mockResolvedValue({ groups: [], steps: [] });
  getStepsMock.mockResolvedValue(threeSteps());
  analyzeMock.mockResolvedValue(analyzeFor(threeSteps()));
  previewMock.mockResolvedValue({ rows: [{ date: "2026-09-14", status: "ok" }], rowCount: 12 });
  scheduleMock.mockRejectedValue(notFound());
  updatePipelineMock.mockResolvedValue(SPINE_PIPELINE);
});

afterEach(() => {
  jest.clearAllMocks();
});

/** A store holding `pipeline`; the page also refetches it by id, so the mocked fetch returns the same one. */
function storeWith(options: Parameters<typeof makeSpineStore>[0] = {}) {
  jest.mocked(getPipelineById).mockResolvedValue(options.pipeline ?? SPINE_PIPELINE);
  return makeSpineStore(options);
}

const spine = () => screen.getByLabelText("Steps and outputs");
const rowButton = (n: number, label: string) =>
  within(spine()).getByRole("button", { name: new RegExp(`^Step ${n}: ${label}`) });

describe("PipelineDetailPage desktop spine: structure", () => {
  it("renders the source card, the numbered steps with summaries and the first step selected", async () => {
    await renderSpinePageSettled();
    const s = within(spine());
    expect(s.getByText("Sales CSV")).toBeInTheDocument();
    expect(s.getByText("CSV")).toBeInTheDocument();
    expect(await s.findByRole("button", { name: /^Step 1: Filter rows/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(rowButton(2, "Sort rows")).not.toHaveAttribute("aria-current");
    expect(s.getByText("duration_s ≥ 180")).toBeInTheDocument();
    expect(s.getByText("date ↑")).toBeInTheDocument();
    expect(s.getByText("duration_min = duration_s / 60")).toBeInTheDocument();
    expect(s.getByText("3 steps")).toBeInTheDocument();
  });

  it("renders the focused editor of the selected step and the rows-after-step table", async () => {
    await renderSpinePageSettled();
    expect(await screen.findByRole("region", { name: "Step 1 Filter rows" })).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Rows after step 1" })).toBeInTheDocument();
    await waitFor(() => expect(previewMock).toHaveBeenCalledWith("pipe-1", "s1"));
    expect(await screen.findByText("12 rows")).toBeInTheDocument();
  });

  it("selecting a step updates the editor, the preview table and the ?step= param (and keeps ?outputId=)", async () => {
    await renderSpinePageSettled(undefined, "/pipelines/pipe-1?outputId=missing");
    await screen.findByRole("region", { name: "Step 1 Filter rows" });
    fireEvent.click(rowButton(2, "Sort rows"));
    expect(await screen.findByRole("region", { name: "Step 2 Sort rows" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Rows after step 2" })).toBeInTheDocument();
    expect(rowButton(2, "Sort rows")).toHaveAttribute("aria-current", "true");
    await waitFor(() => expect(previewMock).toHaveBeenCalledWith("pipe-1", "s2"));
    const search = new URLSearchParams(screen.getByTestId("location-search").textContent ?? "");
    expect(search.get("step")).toBe("s2");
    expect(search.get("outputId")).toBe("missing");
  });

  it("starts on the step named by ?step= and falls back to the first step for an unknown id", async () => {
    const { unmount } = await renderSpinePageSettled(undefined, "/pipelines/pipe-1?step=s3");
    expect(
      await screen.findByRole("region", { name: "Step 3 Compute column" }),
    ).toBeInTheDocument();
    unmount();
    await renderSpinePageSettled(undefined, "/pipelines/pipe-1?step=nope");
    expect(await screen.findByRole("region", { name: "Step 1 Filter rows" })).toBeInTheDocument();
  });

  it("has no tabs, no footer and no river on desktop", async () => {
    await renderSpinePageSettled();
    await screen.findByRole("region", { name: "Step 1 Filter rows" });
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Last run metadata")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preview data" })).not.toBeInTheDocument();
    expect(document.querySelector(".pipeline-detail-page__step-card")).toBeNull();
  });

  it("adds no <main> landmark of its own (the shell's <main> is the page's one landmark)", async () => {
    await renderSpinePageSettled();
    await screen.findByRole("region", { name: "Step 1 Filter rows" });
    expect(document.querySelectorAll("main")).toHaveLength(0);
    expect(screen.getByRole("region", { name: "Step editor and preview" })).toBeInTheDocument();
  });

  it("reserves an empty, zero-width live-output slot (HEL-1581) without building a live render", async () => {
    await renderSpinePageSettled();
    await screen.findByRole("region", { name: "Step 1 Filter rows" });
    const slot = document.querySelector(".spine-body__live-output");
    expect(slot).not.toBeNull();
    expect(slot).toBeEmptyDOMElement();
    expect(screen.queryByText("live")).not.toBeInTheDocument();
  });

  it("shows the empty state in the spine for a pipeline with no steps", async () => {
    getStepsMock.mockResolvedValue([]);
    analyzeMock.mockResolvedValue(analyzeFor([]));
    await renderSpinePageSettled();
    const s = within(spine());
    expect(await s.findByText("No steps yet")).toBeInTheDocument();
    expect(s.getByRole("button", { name: "+ Add step" })).toBeInTheDocument();
    expect(s.getByRole("button", { name: "Add Outputs from a shape" })).toBeInTheDocument();
    expect(s.queryByText(/\d+ steps?$/)).toBeInTheDocument();
    expect(screen.getByText("Nothing to edit yet")).toBeInTheDocument();
  });
});

describe("PipelineDetailPage desktop spine: per-step row counts", () => {
  it("shows the persisted latest run's counts on load, with — for a step that has none", async () => {
    const pipeline = {
      ...SPINE_PIPELINE,
      lastRunStatus: "succeeded" as const,
      lastRunAt: new Date().toISOString(),
      lastRunRowCount: 7,
      lastRunStepRowCounts: { s1: 120, s2: 120 },
    };
    await renderSpinePageSettled(storeWith({ pipeline }));
    expect(
      await within(spine()).findByRole("button", { name: "Step 1: Filter rows, 120 rows" }),
    ).toBeInTheDocument();
    expect(rowButton(2, "Sort rows")).toHaveAccessibleName("Step 2: Sort rows, 120 rows");
    // s3 was added after the run: no count, so no count in its name and a dash on screen.
    expect(rowButton(3, "Compute column")).toHaveAccessibleName("Step 3: Compute column");
    expect(within(rowButton(3, "Compute column")).getByText("—")).toBeInTheDocument();
  });

  it("prefers the in-session run's counts over the persisted ones", async () => {
    const pipeline = { ...SPINE_PIPELINE, lastRunStepRowCounts: { s1: 120, s2: 120, s3: 120 } };
    await renderSpinePageSettled(
      storeWith({ pipeline, runStepRowCounts: { s1: 4, s2: 3, s3: 3 } }),
    );
    expect(
      await within(spine()).findByRole("button", { name: "Step 1: Filter rows, 4 rows" }),
    ).toBeInTheDocument();
    expect(rowButton(3, "Compute column")).toHaveAccessibleName("Step 3: Compute column, 3 rows");
  });

  it("shows 'off' (not a count) for a disabled step", async () => {
    getStepsMock.mockResolvedValue([
      threeSteps()[0],
      { ...threeSteps()[1], enabled: false } as PipelineStep,
      threeSteps()[2],
    ]);
    const pipeline = { ...SPINE_PIPELINE, lastRunStepRowCounts: { s1: 9, s2: 9, s3: 9 } };
    await renderSpinePageSettled(storeWith({ pipeline }));
    const row = await within(spine()).findByRole("button", {
      name: /^Step 2: Sort rows, disabled/,
    });
    expect(within(row).getByText("off")).toBeInTheDocument();
  });

  it("carries the truncation context with persisted counts: a Partial badge and a partial accessible name", async () => {
    const pipeline = {
      ...SPINE_PIPELINE,
      lastRunStatus: "succeeded" as const,
      lastRunAt: new Date().toISOString(),
      lastRunRowCount: 1000,
      lastRunTruncated: true,
      lastRunStepRowCounts: { s1: 1000 },
    };
    await renderSpinePageSettled(storeWith({ pipeline }));
    expect(
      await within(spine()).findByRole("button", {
        name: "Step 1: Filter rows, 1,000 rows, partial (row cap reached)",
      }),
    ).toBeInTheDocument();
    expect(
      within(spine()).getByRole("img", { name: /^Partial: this row count/ }),
    ).toBeInTheDocument();
  });

  it("shows no Partial badge when the persisted run was complete", async () => {
    const pipeline = {
      ...SPINE_PIPELINE,
      lastRunTruncated: false,
      lastRunStepRowCounts: { s1: 5 },
    };
    await renderSpinePageSettled(storeWith({ pipeline }));
    await within(spine()).findByRole("button", { name: "Step 1: Filter rows, 5 rows" });
    expect(within(spine()).queryByRole("img", { name: /^Partial/ })).not.toBeInTheDocument();
  });
});

describe("PipelineDetailPage desktop spine: lanes and sources", () => {
  function branched(): PipelineStep[] {
    return [
      ...threeSteps(),
      wireStep("b1", "limit", { count: 5 }, { parentStepId: "s2", position: 1, rootId: undefined }),
      wireStep(
        "b2",
        "dedupe",
        { keys: ["date"], keep: "first" },
        { parentStepId: "b1", position: 0, rootId: undefined },
      ),
    ];
  }

  it("renders a branch as an indented, labelled sub-spine under the step it branches from", async () => {
    getStepsMock.mockResolvedValue(branched());
    analyzeMock.mockResolvedValue(analyzeFor(branched()));
    await renderSpinePageSettled();
    const lane = await within(spine()).findByRole("group", { name: "Lane" });
    expect(within(lane).getByText(/Lane 1 · from 2 Sort rows/)).toBeInTheDocument();
    expect(within(lane).getByRole("button", { name: /^Step 1: Limit rows/ })).toBeInTheDocument();
    expect(within(lane).getByRole("button", { name: /^Step 2: Dedupe rows/ })).toBeInTheDocument();
    // The lane sits inside the list item of the step it branches from (row 2), not at the end.
    const sortRow = rowButton(2, "Sort rows").closest("li");
    expect(sortRow).toContainElement(lane);
  });

  it("says validation errors and schema warnings in the row's accessible name (the markers sit inside the button)", async () => {
    const steps = threeSteps();
    analyzeMock.mockResolvedValue(
      analyzeFor(steps, {
        steps: analyzeFor(steps).steps.map((st, i) =>
          i === 0 ? { ...st, validationError: "bad value" } : st,
        ) as never,
        warnings: [
          { stepId: "s2", code: "w", message: "w1" },
          { stepId: "s2", code: "w", message: "w2" },
        ] as never,
      }),
    );
    await renderSpinePageSettled();
    expect(
      await within(spine()).findByRole("button", {
        name: /^Step 1: Filter rows.*has a validation error$/,
      }),
    ).toBeInTheDocument();
    expect(rowButton(2, "Sort rows")).toHaveAccessibleName(/2 schema warnings$/);
  });

  it("selects a lane row exactly like a trunk row", async () => {
    getStepsMock.mockResolvedValue(branched());
    analyzeMock.mockResolvedValue(analyzeFor(branched()));
    await renderSpinePageSettled();
    const lane = await within(spine()).findByRole("group", { name: "Lane" });
    fireEvent.click(within(lane).getByRole("button", { name: /^Step 2: Dedupe rows/ }));
    expect(await screen.findByRole("region", { name: "Step 2 Dedupe rows" })).toBeInTheDocument();
    expect(
      new URLSearchParams(screen.getByTestId("location-search").textContent ?? "").get("step"),
    ).toBe("b2");
  });

  it("gives branch rows Branch from here / Add output but no Move or Insert items", async () => {
    getStepsMock.mockResolvedValue(branched());
    analyzeMock.mockResolvedValue(analyzeFor(branched()));
    await renderSpinePageSettled();
    await within(spine()).findByRole("group", { name: "Lane" });
    fireEvent.click(screen.getByRole("button", { name: "Step actions for Limit rows" }));
    const menu = screen.getByRole("menu", { name: "Step actions for Limit rows" });
    expect(within(menu).getByRole("menuitem", { name: "Branch from here" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Add output" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: /Move step/ })).not.toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: /Insert step/ })).not.toBeInTheDocument();
  });

  it("lists every source with its own menu, numbering them when there are several", async () => {
    const pipeline = {
      ...SPINE_PIPELINE,
      roots: [
        { id: "root-1", dataSourceId: "src-1", dataSourceName: "Sales CSV" },
        { id: "root-2", dataSourceId: "src-2", dataSourceName: "Targets" },
      ],
    };
    await renderSpinePageSettled(storeWith({ pipeline }));
    const s = within(spine());
    expect(await s.findByRole("heading", { name: "Sources" })).toBeInTheDocument();
    expect(s.getByText("Targets")).toBeInTheDocument();
    expect(s.getByText("From Targets")).toBeInTheDocument();
    expect(s.getByText(/No steps yet — join this source/)).toBeInTheDocument();
    fireEvent.click(s.getByRole("button", { name: "Source actions for Targets" }));
    expect(
      screen.getByRole("menuitem", { name: "Remove source Targets from this pipeline" }),
    ).toBeEnabled();
  });

  it("disables 'Remove from pipeline' when the pipeline has a single source", async () => {
    await renderSpinePageSettled();
    fireEvent.click(
      await within(spine()).findByRole("button", { name: "Source actions for Sales CSV" }),
    );
    expect(
      screen.getByRole("menuitem", { name: "Remove source Sales CSV from this pipeline" }),
    ).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Edit source Sales CSV" })).toBeEnabled();
  });

  it("renders a source that is not resolvable in the caller's list by name only, with no Edit item", async () => {
    await renderSpinePageSettled(storeWith({ sources: [] }));
    const s = within(spine());
    expect(await s.findByText("Sales CSV")).toBeInTheDocument();
    fireEvent.click(s.getByRole("button", { name: "Source actions for Sales CSV" }));
    expect(screen.queryByRole("menuitem", { name: /Edit source/ })).not.toBeInTheDocument();
  });
});

describe("PipelineDetailPage desktop spine: outputs section", () => {
  it("lists every Output with its kind, panel count and the step it hangs off", async () => {
    const outputs = [
      makeOutput("o1", "runs_trend", { kind: "chart", panelCount: 1 }),
      makeOutput("o2", "runs_table", { panelCount: 3 }),
    ];
    await renderSpinePageSettled(storeWith({ outputs }));
    const section = within(await screen.findByRole("region", { name: "Outputs" }));
    expect(section.getByText("runs_trend")).toBeInTheDocument();
    expect(section.getByText("Chart · used in 1 panel")).toBeInTheDocument();
    expect(section.getByText("Table · used in 3 panels")).toBeInTheDocument();
    expect(section.getAllByText("off Compute column")).toHaveLength(2);
    expect(section.getByRole("button", { name: "New output" })).toBeInTheDocument();
  });

  it("issues no per-Output placements GET on first paint (the panel count comes with the Outputs list)", async () => {
    const outputs = [makeOutput("o1", "runs_trend", { panelCount: 2 })];
    await renderSpinePageSettled(storeWith({ outputs }));
    await within(await screen.findByRole("region", { name: "Outputs" })).findByText(
      "Table · used in 2 panels",
    );
    await waitFor(() => expect(previewMock).toHaveBeenCalled());
    const urls = jest.mocked(httpClient.get).mock.calls.map(([url]) => String(url));
    expect(urls.filter((u) => u.endsWith("/panels"))).toEqual([]);
  });

  it("opens the Output editor sheet from a card, and offers History in its menu", async () => {
    const outputs = [makeOutput("o1", "runs_trend", { panelCount: 0 })];
    await renderSpinePageSettled(storeWith({ outputs }));
    const section = within(await screen.findByRole("region", { name: "Outputs" }));
    fireEvent.click(section.getByRole("button", { name: "Open runs_trend output" }));
    expect(await screen.findByRole("textbox", { name: "Name" })).toBeInTheDocument();
  });

  it("says 'used in 0 panels' honestly and omits the count when the server did not send one", async () => {
    const outputs = [makeOutput("o1", "unused", { panelCount: 0 }), makeOutput("o2", "unknown")];
    await renderSpinePageSettled(storeWith({ outputs }));
    const section = within(await screen.findByRole("region", { name: "Outputs" }));
    expect(section.getByText("Table · used in 0 panels")).toBeInTheDocument();
    expect(section.getByText("Table")).toBeInTheDocument();
  });
});

describe("PipelineDetailPage desktop spine: header", () => {
  it("shows the breadcrumb, the name in a quiet button and one primary action", async () => {
    await renderSpinePageSettled();
    expect(screen.getByRole("link", { name: "Pipelines" })).toHaveAttribute("href", "/pipelines");
    expect(screen.getByRole("button", { name: "Edit pipeline name" })).toHaveTextContent(
      "Revenue rollup",
    );
    expect(screen.getByRole("button", { name: "Run pipeline" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dry run" })).toBeInTheDocument();
    // The name is a label, not a display title (DESIGN §9): the shell owns the <h1>.
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });

  it("never offers Delete for the pipeline or its source (owner ruling: Delete lives on the overview rows)", async () => {
    await renderSpinePageSettled(
      storeWith({ currentUserId: "u-1", pipeline: { ...SPINE_PIPELINE, ownerId: "u-1" } }),
    );
    await screen.findByRole("region", { name: "Step 1 Filter rows" });
    fireEvent.click(screen.getByRole("button", { name: "Pipeline actions" }));
    expect(screen.queryByRole("menuitem", { name: /delete/i })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Source actions for Sales CSV" }));
    expect(screen.queryByRole("menuitem", { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("renames inline: edit, Save sends the new name, Cancel asks before discarding", async () => {
    await renderSpinePageSettled();
    fireEvent.click(screen.getByRole("button", { name: "Edit pipeline name" }));
    const input = screen.getByRole("textbox", { name: "Pipeline name" });
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.click(await screen.findByRole("button", { name: "Save pipeline" }));
    await waitFor(() => expect(updatePipelineMock).toHaveBeenCalledWith("pipe-1", "Renamed"));
  });

  it("asks before discarding unsaved name changes; Keep editing keeps them, Discard drops them", async () => {
    await renderSpinePageSettled();
    fireEvent.click(screen.getByRole("button", { name: "Edit pipeline name" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Pipeline name" }), {
      target: { value: "Draft name" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Cancel changes" }));
    const dialog = screen.getByRole("alertdialog", { name: "Discard unsaved changes" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save pipeline" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Discard changes" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Save pipeline" })).not.toBeInTheDocument(),
    );
    // Discarding leaves the page (the cancel flow's existing behaviour) without having saved the draft name.
    expect(await screen.findByText("Pipelines List")).toBeInTheDocument();
    expect(updatePipelineMock).not.toHaveBeenCalled();
  });

  it("shows a failed save as an alert next to the name", async () => {
    await renderSpinePageSettled(storeWith({ updateError: "Name already taken" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit pipeline name" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Pipeline name" }), {
      target: { value: "x" },
    });
    expect(await screen.findByRole("alert", { name: "Save error" })).toHaveTextContent(
      "Name already taken",
    );
  });

  it("shows rows written and the relative last-run time, with the Partial badge when truncated", async () => {
    const pipeline = {
      ...SPINE_PIPELINE,
      lastRunStatus: "succeeded" as const,
      lastRunAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
      lastRunRowCount: 22,
      lastRunTruncated: true,
    };
    await renderSpinePageSettled(storeWith({ pipeline }));
    const meta = await screen.findByLabelText("Last run metadata");
    expect(meta).toHaveTextContent("22 rows written · 3 minutes ago");
    expect(within(meta).getByRole("img", { name: /^Partial/ })).toBeInTheDocument();
    expect(screen.getByText("Succeeded")).toBeInTheDocument();
  });

  it("does not crash and omits rows written when the persisted row count is missing", async () => {
    const pipeline = {
      ...SPINE_PIPELINE,
      lastRunStatus: "failed" as const,
      lastRunAt: new Date().toISOString(),
      lastRunRowCount: undefined as unknown as null,
    };
    await renderSpinePageSettled(storeWith({ pipeline }));
    const meta = await screen.findByLabelText("Last run metadata");
    expect(meta).not.toHaveTextContent("rows written");
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it.each([
    ["queued", "Queued…"],
    ["running", "Running…"],
  ] as const)(
    "shows the in-session run status %s as a status chip and disables Run and Dry run",
    async (status, text) => {
      await renderSpinePageSettled(storeWith({ runStatus: status }));
      const chip = await screen.findByLabelText(`Run status: ${status}`);
      expect(chip).toHaveTextContent(text);
      expect(screen.getByRole("button", { name: "Run pipeline" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Dry run" })).toBeDisabled();
    },
  );

  it("shows a dry run's preview row count and a failed run's error log", async () => {
    const { unmount } = await renderSpinePageSettled(
      storeWith({ runStatus: "succeeded", runIsDry: true, runResult: [{ a: 1 }, { a: 2 }] }),
    );
    expect(await screen.findByLabelText("Run status: succeeded")).toHaveTextContent(
      "Preview: 2 rows",
    );
    unmount();
    await renderSpinePageSettled(storeWith({ runStatus: "failed" }));
    expect(await screen.findByLabelText("Run status: failed")).toHaveTextContent("Failed");
  });
});

describe("PipelineDetailPage desktop spine: schedule chip and menu", () => {
  it("offers 'Add schedule' when there is none and opens the schedule dialog", async () => {
    await renderSpinePageSettled();
    fireEvent.click(screen.getByRole("button", { name: "Add schedule" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("shows the expression and a Paused marker for a disabled schedule, and Resume in the menu", async () => {
    scheduleMock.mockResolvedValue(
      schedule({ enabled: false, kind: "interval", expression: "15m" }),
    );
    putScheduleMock.mockResolvedValue(
      schedule({ enabled: true, kind: "interval", expression: "15m" }),
    );
    await renderSpinePageSettled();
    const chip = await screen.findByRole("button", { name: "Edit schedule, paused" });
    expect(chip).toHaveTextContent("Every 15m");
    expect(chip).toHaveTextContent("Paused");
    fireEvent.click(screen.getByRole("button", { name: "Pipeline actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Resume schedule" }));
    await waitFor(() =>
      expect(putScheduleMock).toHaveBeenCalledWith("pipe-1", {
        kind: "interval",
        expression: "15m",
        timezone: "UTC",
        enabled: true,
      }),
    );
  });

  it("Pause sends the unchanged kind/expression/timezone with enabled false", async () => {
    scheduleMock.mockResolvedValue(schedule());
    putScheduleMock.mockResolvedValue(schedule({ enabled: false }));
    await renderSpinePageSettled();
    await screen.findByRole("button", { name: "Edit schedule" });
    fireEvent.click(screen.getByRole("button", { name: "Pipeline actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Pause schedule" }));
    await waitFor(() =>
      expect(putScheduleMock).toHaveBeenCalledWith("pipe-1", {
        kind: "cron",
        expression: "0 6 * * *",
        timezone: "UTC",
        enabled: false,
      }),
    );
  });

  it("keeps every former header action reachable: Rename, Set schedule, Run history, Share (owner), Edit source", async () => {
    const pipeline = { ...SPINE_PIPELINE, ownerId: "u-1" };
    await renderSpinePageSettled(storeWith({ pipeline, currentUserId: "u-1" }));
    await screen.findByRole("region", { name: "Step 1 Filter rows" });
    fireEvent.click(screen.getByRole("button", { name: "Pipeline actions" }));
    const menu = screen.getByRole("menu", { name: "Pipeline actions" });
    for (const name of ["Rename", "Edit source", "Set schedule", "Run history", "Share"]) {
      expect(within(menu).getByRole("menuitem", { name })).toBeInTheDocument();
    }
    expect(
      within(menu).queryByRole("menuitem", { name: "Pause schedule" }),
    ).not.toBeInTheDocument();
  });

  it("omits Share for a non-owner and the singular Edit source when there are several sources", async () => {
    const pipeline = {
      ...SPINE_PIPELINE,
      roots: [
        { id: "root-1", dataSourceId: "src-1", dataSourceName: "Sales CSV" },
        { id: "root-2", dataSourceId: "src-2", dataSourceName: "Targets" },
      ],
    };
    await renderSpinePageSettled(storeWith({ pipeline }));
    await screen.findByRole("region", { name: "Step 1 Filter rows" });
    fireEvent.click(screen.getByRole("button", { name: "Pipeline actions" }));
    const menu = screen.getByRole("menu", { name: "Pipeline actions" });
    expect(within(menu).queryByRole("menuitem", { name: "Share" })).not.toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Edit source" })).not.toBeInTheDocument();
  });

  it("opens run history from the menu", async () => {
    await renderSpinePageSettled();
    await screen.findByRole("region", { name: "Step 1 Filter rows" });
    fireEvent.click(screen.getByRole("button", { name: "Pipeline actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Run history" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});

describe("PipelineDetailPage desktop spine: status strip", () => {
  it("shows the cost-verdict denial with 'Run to update' under the header", async () => {
    analyzeMock.mockResolvedValue(
      analyzeFor(threeSteps(), {
        costVerdict: {
          autoRunnable: false,
          stepCount: 3,
          reasons: [{ code: "ai-step", detail: "uses AI" }],
          canRun: true,
        },
      }),
    );
    await renderSpinePageSettled();
    const denial = (await screen.findByText(/wasn't updated automatically/)).closest(
      '[role="status"]',
    ) as HTMLElement;
    expect(within(denial).getByRole("button", { name: "Run to update" })).toBeInTheDocument();
  });

  it("shows the live truncation notice, else the persisted one", async () => {
    await renderSpinePageSettled(
      storeWith({
        runSourceTruncated: true,
        runTruncationNotice: "Only 1,000 of 5,000 rows read.",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Only 1,000 of 5,000 rows read.");
  });
});

describe("PipelineDetailPage phone path (HEL-1582)", () => {
  let restore: () => void;
  beforeEach(() => {
    restore = installPhoneShell();
  });
  afterEach(() => restore());

  it("renders the phone layout at the phone breakpoint: header, Steps / Preview / Runs tabs, step list and floating run pills; no river, Outputs tab or footer, and not the spine", async () => {
    await renderSpinePageSettled();
    expect(screen.getByRole("tab", { name: "Steps" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Preview" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Runs" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Outputs/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to pipelines" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pipeline actions" })).toBeInTheDocument();
    expect(await screen.findByText("+ Add step")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run pipeline" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dry run" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Steps and outputs")).not.toBeInTheDocument();
    expect(document.querySelector(".pipeline-detail-page--spine")).toBeNull();
    expect(document.querySelector(".pipeline-detail-page--mobile")).not.toBeNull();
    // Retired: the river, its ribbon and footer, and the phone Outputs gallery.
    for (const retired of [
      ".pipeline-detail-page__river",
      ".pipeline-detail-page__footer",
      ".pipeline-detail-page__footer-region",
      ".pipeline-detail-header",
      ".outputs-gallery",
    ]) {
      expect(document.querySelector(retired)).toBeNull();
    }
  });
});
