// HEL-1809 (design.md D5 ii): a Pattern-style edit after the first one re-renders the step editor and the preview, not the page
// header. Counts renders of header descendants and of the preview table through wrappers (no wall-clock). Rendered WITHOUT
// StrictMode, so one commit is one render. The first edit legitimately changes the header (draft chrome), so it is excluded.

import { fireEvent, screen } from "@testing-library/react";

import {
  analyzePipeline,
  fetchRunHistory,
  fetchStepPreview,
  getPipelineById,
  getPipelineSchedule,
  getPipelineStepCatalog,
  getPipelineSteps,
} from "../services/pipelineService";
import { listOutputs } from "../services/outputService";
import { httpClient } from "../../../services/httpClient";
import type { SourceSample } from "../../sources/types/dataSource";
import {
  SPINE_PIPELINE,
  analyzeFor,
  makeOutput,
  makeSpineStore,
  renderSpinePageSettled,
  threeSteps,
} from "./pipelineSpineTestKit";

// Render counters: each wrapper renders exactly when its (real) child is asked to render.
const counts = {
  runStatus: 0,
  scheduleChip: 0,
  previewTable: 0,
  detailDialogs: 0,
  draftDialogs: 0,
  sourceCard: 0,
  outputs: 0,
  rows: {} as Record<string, number>,
};
// Each probe below sits inside exactly one component and is called once per render of it: the schedule dialog is a
// non-memoised stand-in rendered by `PipelineDetailDialogs`, the leave-guard hook is called by `PipelineDraftDialogs`, the
// sample-label hook by `SpineSourceCard`, the Output card's actions menu by `SpineOutputs` (once per Output) and the summary helper by
// `SpineStepRow` (once per row render).
jest.mock("./schedule/PipelineScheduleDialog", () => {
  const actual = jest.requireActual("./schedule/PipelineScheduleDialog");
  const { createElement } = jest.requireActual("react");
  return {
    ...actual,
    PipelineScheduleDialog: (props: object) => {
      counts.detailDialogs += 1;
      return createElement(actual.PipelineScheduleDialog, props);
    },
  };
});
jest.mock("../hooks/useDraftLeaveGuard", () => {
  const actual = jest.requireActual("../hooks/useDraftLeaveGuard");
  return {
    ...actual,
    useDraftLeaveGuard: (...args: unknown[]) => {
      counts.draftDialogs += 1;
      return actual.useDraftLeaveGuard(...args);
    },
  };
});
jest.mock("../../sources/hooks/useSourceSampleLabel", () => {
  const actual = jest.requireActual("../../sources/hooks/useSourceSampleLabel");
  return {
    ...actual,
    useSourceSampleLabel: (...args: unknown[]) => {
      counts.sourceCard += 1;
      return actual.useSourceSampleLabel(...args);
    },
  };
});
jest.mock("../../../shared/chrome/ActionsMenu", () => {
  const actual = jest.requireActual("../../../shared/chrome/ActionsMenu");
  const { createElement } = jest.requireActual("react");
  return {
    ...actual,
    ActionsMenu: (props: { label: string }) => {
      if (props.label.startsWith("Output actions for")) counts.outputs += 1;
      return createElement(actual.ActionsMenu, props);
    },
  };
});
jest.mock("../state/summarizeStepConfig", () => {
  const actual = jest.requireActual("../state/summarizeStepConfig");
  return {
    ...actual,
    summarizeStepConfig: (step: { id: string }) => {
      counts.rows[step.id] = (counts.rows[step.id] ?? 0) + 1;
      return actual.summarizeStepConfig(step);
    },
  };
});
jest.mock("./spine/SpineRunStatus", () => {
  const actual = jest.requireActual("./spine/SpineRunStatus");
  const { createElement } = jest.requireActual("react");
  return {
    ...actual,
    SpineRunStatus: (props: object) => {
      counts.runStatus += 1;
      return createElement(actual.SpineRunStatus, props);
    },
  };
});
jest.mock("./spine/SpineScheduleChip", () => {
  const actual = jest.requireActual("./spine/SpineScheduleChip");
  const { createElement } = jest.requireActual("react");
  return {
    ...actual,
    SpineScheduleChip: (props: object) => {
      counts.scheduleChip += 1;
      return createElement(actual.SpineScheduleChip, props);
    },
  };
});
jest.mock("./spine/StepPreviewTable", () => {
  const actual = jest.requireActual("./spine/StepPreviewTable");
  const { createElement } = jest.requireActual("react");
  return {
    ...actual,
    StepPreviewTable: (props: object) => {
      counts.previewTable += 1;
      return createElement(actual.StepPreviewTable, props);
    },
  };
});

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
  listOutputs: jest.fn(),
}));

const getStepsMock = jest.mocked(getPipelineSteps);
const getByIdMock = jest.mocked(getPipelineById);
const previewMock = jest.mocked(fetchStepPreview);
const analyzeMock = jest.mocked(analyzePipeline);

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
  jest.mocked(listOutputs).mockResolvedValue([]);
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
});

afterEach(() => {
  jest.clearAllMocks();
});

async function renderDraftPage() {
  const outputs = [makeOutput("o1", "Revenue table")];
  const store = makeSpineStore({ samples: { "src-1": SAMPLE }, outputs });
  jest.mocked(listOutputs).mockResolvedValue(outputs);
  await renderSpinePageSettled(store);
  await screen.findByRole("region", { name: "Step 1 Filter rows" });
}

describe("a field edit on the pipeline page (HEL-1809)", () => {
  it("re-renders the preview but not the page header after the first edit", async () => {
    await renderDraftPage();

    // The first edit turns on the draft chrome, so the header changes legitimately.
    fireEvent.change(screen.getByDisplayValue("180"), { target: { value: "240" } });
    expect(screen.getByText("Draft · unsaved changes")).toBeInTheDocument();
    const header = { ...counts, rows: { ...counts.rows } };

    let current = "240";
    for (const next of ["245", "246", "247"]) {
      fireEvent.change(screen.getByDisplayValue(current), { target: { value: next } });
      current = next;
    }

    // The positive control: the table that shows the edit's rows did render for each of the three keystrokes.
    expect(counts.previewTable - header.previewTable).toBeGreaterThanOrEqual(3);
    // Everything the edit does not touch must not render again: the header, the closed dialog hosts, the source card, the
    // Outputs section and the rows of the unedited steps (s2, s3). One object, so a failure lists every component.
    expect({
      runStatus: counts.runStatus - header.runStatus,
      scheduleChip: counts.scheduleChip - header.scheduleChip,
      detailDialogs: counts.detailDialogs - header.detailDialogs,
      draftDialogs: counts.draftDialogs - header.draftDialogs,
      sourceCard: counts.sourceCard - header.sourceCard,
      outputs: counts.outputs - header.outputs,
      rowS2: (counts.rows.s2 ?? 0) - (header.rows.s2 ?? 0),
      rowS3: (counts.rows.s3 ?? 0) - (header.rows.s3 ?? 0),
    }).toEqual({
      runStatus: 0,
      scheduleChip: 0,
      detailDialogs: 0,
      draftDialogs: 0,
      sourceCard: 0,
      outputs: 0,
      rowS2: 0,
      rowS3: 0,
    });
    // The thresholds keep the filter's output count at 2, so the downstream rows' displayed counts do not change either.
    // The edited row (s1) shows its new count on each keystroke.
    expect((counts.rows.s1 ?? 0) - (header.rows.s1 ?? 0)).toBeGreaterThanOrEqual(3);
  });
});
