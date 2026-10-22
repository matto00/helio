// HEL-1685 (item 8): crossing the phone boundary while a draft is in error keeps each step's last good draft frame.
// The view tracker and the incremental walker live on the page hook, which survives the layout swap.

import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";

import {
  analyzePipeline,
  fetchRunHistory,
  fetchStepPreview,
  getPipelineById,
  getPipelineSchedule,
  getPipelineStepCatalog,
  getPipelineSteps,
} from "../services/pipelineService";
import { getPipelineWithDefinition } from "../services/draftSaveService";
import { httpClient } from "../../../services/httpClient";
import type { SourceSample } from "../../sources/types/dataSource";
import { stepRow } from "./pipelineMobileTestKit";
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

const DURATIONS = [100, 150, 180, 200, 250, 300];
const SAMPLE: SourceSample = {
  rows: DURATIONS.map((d, i) => ({ date: `2026-09-0${i + 1}`, status: "ok", duration_s: d })),
  capturedAt: "2026-10-19T00:00:00Z",
  sourceRowCount: DURATIONS.length,
  truncated: false,
  live: false,
};

// filter (4 rows saved) -> compute (4 rows saved) -> limit
const STEPS = [
  ...threeSteps().slice(0, 1),
  wireStep(
    "s2",
    "compute",
    { column: "duration_min", expression: "$duration_s / 60" },
    { parentStepId: "s1", position: 0, rootId: undefined },
  ),
  wireStep("s3", "limit", { count: 10 }, { parentStepId: "s2", position: 0, rootId: undefined }),
];

/** A `matchMedia` whose phone-shell query can be flipped after mount, notifying subscribers like a window resize. */
function installFlippableShell() {
  const original = window.matchMedia;
  let phone = false;
  const listeners = new Set<() => void>();
  window.matchMedia = ((query: string) =>
    ({
      get matches() {
        return phone && query === "(max-width: 768px)";
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_type: string, fn: () => void) => listeners.delete(fn),
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
  return {
    toPhone: () =>
      act(() => {
        phone = true;
        listeners.forEach((fn) => fn());
      }),
    restore: () => {
      window.matchMedia = original;
    },
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

let shell: ReturnType<typeof installFlippableShell>;
beforeEach(() => {
  shell = installFlippableShell();
  jest.mocked(httpClient.get).mockResolvedValue({ data: { columns: [], capabilities: {} } });
  jest.mocked(fetchRunHistory).mockResolvedValue([]);
  jest.mocked(getPipelineById).mockResolvedValue(SPINE_PIPELINE);
  jest.mocked(getPipelineStepCatalog).mockResolvedValue({ groups: [], steps: [] });
  jest
    .mocked(getPipelineSchedule)
    .mockRejectedValue({ isAxiosError: true, response: { status: 404 } });
  jest.mocked(getPipelineSteps).mockResolvedValue(STEPS);
  jest.mocked(analyzePipeline).mockResolvedValue(analyzeFor(STEPS));
  jest.mocked(fetchStepPreview).mockResolvedValue({ rows: [{ date: "2026-09-14" }], rowCount: 1 });
  jest
    .mocked(getPipelineWithDefinition)
    .mockResolvedValue({ ...SPINE_PIPELINE, fingerprint: "v1:" + "a".repeat(64) } as never);
});

afterEach(() => {
  cleanup();
  shell.restore();
  jest.clearAllMocks();
});

const countOf = (row: HTMLElement) => row.querySelector(".spine-row__count")?.textContent;

describe("draft frames survive a desktop to phone switch (HEL-1685 item 8)", () => {
  it("keeps the errored step's last good draft count, not the saved one", async () => {
    await renderSpinePageSettled(makeSpineStore({ samples: { "src-1": SAMPLE }, outputs: [] }));
    await screen.findByRole("region", { name: "Step 1 Filter rows" });
    const spine = screen.getByLabelText("Steps and outputs");
    const desktopRow = (label: string) =>
      within(spine).getByRole("button", { name: new RegExp(`^Step \\d+: ${label}`) });

    fireEvent.change(screen.getByDisplayValue("180"), { target: { value: "240" } });
    expect(countOf(desktopRow("Compute column"))).toBe("4 → 2");

    fireEvent.click(desktopRow("Compute column"));
    fireEvent.change(await screen.findByRole("textbox", { name: "Expression" }), {
      target: { value: "$duration_s /" },
    });
    expect(
      within(desktopRow("Compute column")).getByRole("img", { name: /error in the draft/i }),
    ).toBeInTheDocument();
    expect(countOf(desktopRow("Compute column"))).toBe("4 → 2");

    shell.toPhone();

    const phoneRow = await screen.findByRole("button", { name: /^Step \d+: Compute column/ });
    expect(phoneRow).toBe(stepRow("Compute column"));
    expect(countOf(phoneRow)).toBe("4 → 2");

    fireEvent.click(phoneRow);
    const sheet = await screen.findByRole("dialog", { name: "Step editor" });
    expect(within(sheet).getAllByRole("row").length - 1).toBe(2);
  });
});
