// HEL-1582: the phone pipeline page (at or below 768px) -- header, Steps / Preview / Runs tabs, the step list, the step
// sheet, the floating run pills and their clearance slot. jsdom has no `matchMedia`, so every case stubs the phone
// shell. The shared sheet primitive has its own tests (`shared/motion/BottomSheet.test.tsx`).
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";

import * as sampleAccess from "../../../sources/hooks/useSourceSampleAccess";
import { renderWithStore } from "../../../../test/renderWithStore";
import { httpClient } from "../../../../services/httpClient";
import {
  analyzePipeline,
  fetchRunHistory,
  fetchStepPreview,
  getPipelineById,
  getPipelineSchedule,
  getPipelineStepCatalog,
  deletePipelineStep,
  getPipelineSteps,
  reorderPipelineSteps,
  updatePipelineStep,
} from "../../services/pipelineService";
import { OP_TYPES, makeStep } from "../../state/stepNarrowing";
import type { PipelineSchedule } from "../../types/pipelineSchedule";
import type { PipelineStep } from "../../types/pipelineStep";
import { BottomSheet } from "../../../../shared/motion/BottomSheet";
import { StepCardFocused } from "../StepCardFocused";
import { SpineRunStatus } from "../spine/SpineRunStatus";
import { installPhoneShell } from "../pipelineDetailPageTestUtils";
import {
  closeStepSheet,
  findStepRow,
  openStepSheet,
  queryStepSheet,
  stepRow,
  stepRows,
  stepSheet,
  stubDialogMethods,
} from "../pipelineMobileTestKit";
import {
  SPINE_PIPELINE,
  analyzeFor,
  makeOutput,
  makeSpineStore,
  renderSpinePageSettled,
  threeSteps,
  wireStep,
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

const previewMock = jest.mocked(fetchStepPreview);
const historyMock = jest.mocked(fetchRunHistory);
const scheduleMock = jest.mocked(getPipelineSchedule);

let restorePhone: () => void;

beforeAll(() => stubDialogMethods());

beforeEach(() => {
  restorePhone = installPhoneShell();
  jest.mocked(httpClient.get).mockResolvedValue({ data: { rows: [], rowCount: 0 } });
  historyMock.mockResolvedValue([]);
  jest.mocked(getPipelineById).mockResolvedValue(SPINE_PIPELINE);
  jest.mocked(getPipelineStepCatalog).mockResolvedValue({ groups: [], steps: [] });
  jest.mocked(getPipelineSteps).mockResolvedValue(threeSteps());
  jest.mocked(analyzePipeline).mockResolvedValue(analyzeFor(threeSteps()));
  previewMock.mockResolvedValue({ rows: [{ date: "2026-09-14", status: "ok" }], rowCount: 12 });
  scheduleMock.mockRejectedValue({ isAxiosError: true, response: { status: 404 } });
});

afterEach(() => {
  restorePhone();
  jest.clearAllMocks();
});

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

/** A store holding `pipeline` (the page also refetches it by id, so the mocked fetch returns the same one). */
function storeWith(options: Parameters<typeof makeSpineStore>[0] = {}) {
  jest.mocked(getPipelineById).mockResolvedValue(options.pipeline ?? SPINE_PIPELINE);
  return makeSpineStore(options);
}

describe("phone header", () => {
  it("shows a back link, the mono name in one truncated line (full name in its title) and the actions menu", async () => {
    await renderSpinePageSettled();
    expect(screen.getByRole("link", { name: "Back to pipelines" })).toHaveAttribute(
      "href",
      "/pipelines",
    );
    const name = screen.getByText("Revenue rollup");
    expect(name).toHaveAttribute("title", "Revenue rollup");
    // Not a heading: the shell's sr-only <h1> stays the landmark.
    expect(screen.queryByRole("heading", { name: "Revenue rollup" })).toBeNull();
    expect(screen.getByRole("button", { name: "Pipeline actions" })).toBeInTheDocument();
  });

  it("a never-run pipeline shows no last-run figures", async () => {
    await renderSpinePageSettled();
    expect(screen.queryByLabelText("Last run metadata")).toBeNull();
    expect(screen.queryByText(/rows written/)).toBeNull();
  });

  it("a paused schedule shows a visible 'Paused' marker in the status line", async () => {
    scheduleMock.mockResolvedValue(schedule({ enabled: false }));
    await renderSpinePageSettled();
    expect(await screen.findByText("Paused")).toBeVisible();
    expect(screen.getByRole("button", { name: "Edit schedule, paused" })).toBeInTheDocument();
  });

  it("the actions menu holds Rename, Add source, Add Outputs from a shape and the schedule items", async () => {
    await renderSpinePageSettled();
    fireEvent.click(screen.getByRole("button", { name: "Pipeline actions" }));
    for (const item of ["Rename", "Add source", "Add Outputs from a shape", "Set schedule"]) {
      expect(screen.getByRole("menuitem", { name: item })).toBeInTheDocument();
    }
    // Run history is the Runs tab, not a menu item; Share is owner-only; Delete lives only on the overview rows.
    expect(screen.queryByRole("menuitem", { name: "Run history" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /Delete/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Share" })).toBeNull();
  });

  it("a failed run's full error stays reachable from the status label's title", () => {
    renderWithStore(
      <SpineRunStatus
        run={{
          sseStatus: null,
          sseRowCount: null,
          sseErrorLog: null,
          runStatus: "failed",
          runError: "disk full while writing the snapshot",
          runIsDry: false,
          runResult: null,
        }}
        lastRunStatus={null}
      />,
    );
    expect(screen.getByLabelText("Run status: failed")).toHaveAttribute(
      "title",
      "disk full while writing the snapshot",
    );
  });
});

describe("phone Steps tab", () => {
  it("lists the source card, numbered rows with mono summaries, the add row and the output card", async () => {
    await renderSpinePageSettled(makeSpineStore({ outputs: [makeOutput("o1", "runs_trend")] }));
    expect(await findStepRow(/Filter rows/)).toHaveAttribute("aria-haspopup", "dialog");
    expect(stepRows()).toHaveLength(3);
    expect(screen.getByText("Sales CSV")).toBeInTheDocument();
    expect(screen.getByText("duration_s ≥ 180")).toBeInTheDocument();
    expect(screen.getByText("3 steps")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Add transformation step" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open runs_trend output" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New output" })).toBeInTheDocument();
    // Moved to the header's actions menu; no drag grip or per-row menu on the phone.
    expect(screen.queryByRole("button", { name: "Add source" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Outputs from a shape" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Step actions for/ })).toBeNull();
    expect(document.querySelector(".spine-row__grip")).toBeNull();
  });

  it("the source's mono name is the Edit source button and its menu stays a sibling, never nested", async () => {
    await renderSpinePageSettled();
    const edit = await screen.findByRole("button", { name: "Edit source Sales CSV" });
    const menu = screen.getByRole("button", { name: "Source actions for Sales CSV" });
    expect(edit).not.toContainElement(menu);
    expect(menu.closest(".spine-card__name-btn")).toBeNull();
    fireEvent.click(menu);
    expect(screen.getByRole("menuitem", { name: /Remove source Sales CSV/ })).toBeDisabled();
  });

  it("scopes the source card's sample label to the pipeline, so an editor of a shared pipeline can sample (HEL-1648)", async () => {
    const access = jest.spyOn(sampleAccess, "useSourceSampleAccess");
    await renderSpinePageSettled();
    await screen.findByRole("button", { name: "Edit source Sales CSV" });
    expect(access).toHaveBeenCalledWith("pipe-1", expect.any(String));
    access.mockRestore();
  });

  it("keeps HEL-1628's sample label and its refresh control on the source card", async () => {
    await renderSpinePageSettled();
    const card = (await screen.findByRole("button", { name: "Edit source Sales CSV" })).closest(
      ".spine-source-card",
    ) as HTMLElement;
    expect(card.querySelector(".source-sample-label")).not.toBeNull();
    expect(
      within(card).getByRole("button", { name: "Refresh sample of Sales CSV" }),
    ).toBeInTheDocument();
  });

  it("keeps the partial-count badge visible next to the step count when the counts are partial", async () => {
    const store = storeWith({
      pipeline: { ...SPINE_PIPELINE, lastRunTruncated: true, lastRunStepRowCounts: { s1: 1000 } },
    });
    await renderSpinePageSettled(store);
    expect(await screen.findByText("3 steps")).toBeVisible();
    expect(screen.getByRole("img", { name: /^Partial: this row count/ })).toBeInTheDocument();
  });

  it("a step on a branch lane shows its validation marker, as the desktop spine does", async () => {
    const steps: PipelineStep[] = [
      ...threeSteps(),
      wireStep("b1", "limit", { count: 5 }, { parentStepId: "s2", position: 1, rootId: undefined }),
    ];
    jest.mocked(getPipelineSteps).mockResolvedValue(steps);
    const analysis = analyzeFor(steps);
    jest.mocked(analyzePipeline).mockResolvedValue({
      ...analysis,
      steps: analysis.steps.map((st) =>
        st.id === "b1" ? { ...st, validationError: "bad value" } : st,
      ) as never,
    });
    await renderSpinePageSettled();
    expect(
      await screen.findByRole("button", { name: /^Step 1: Limit rows.*has a validation error$/ }),
    ).toBeInTheDocument();
    expect(stepRow(/Limit rows/).closest(".spine-lane--sub")).not.toBeNull();
  });
});

describe("phone tabs mount on activation only", () => {
  it("opening the page requests neither a preview nor the run history", async () => {
    await renderSpinePageSettled();
    await findStepRow(/Filter rows/);
    expect(previewMock).not.toHaveBeenCalled();
    expect(historyMock).not.toHaveBeenCalled();
  });

  it("Preview shows the last step by default with its schema chips and rows", async () => {
    await renderSpinePageSettled();
    fireEvent.click(await screen.findByRole("tab", { name: "Preview" }));
    expect(await screen.findByRole("combobox", { name: "Previewed step" })).toHaveTextContent(
      "Step 3 · Compute column",
    );
    expect(await screen.findByRole("region", { name: "Rows after step 3" })).toBeInTheDocument();
    await waitFor(() => expect(previewMock).toHaveBeenCalledWith("pipe-1", "s3"));
    expect(await screen.findByText("12 rows")).toBeInTheDocument();
    expect(screen.getByLabelText("Output schema")).toBeInTheDocument();
  });

  it("Runs lists the history inline on first activation and never opens the Run history modal", async () => {
    historyMock.mockResolvedValue([
      {
        id: "run-1",
        pipelineId: "pipe-1",
        status: "succeeded",
        startedAt: "2026-05-01T10:00:00Z",
        completedAt: "2026-05-01T10:01:00Z",
        rowCount: 42,
        errorLog: null,
        triggerSource: "manual",
        assertions: { passed: 0, warnFailed: 0, errorFailed: 0, failures: [] },
      },
    ]);
    await renderSpinePageSettled();
    await findStepRow(/Filter rows/);
    expect(historyMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: "Runs" }));
    expect(await screen.findByText("42 rows")).toBeInTheDocument();
    expect(historyMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "Run history" })).toBeNull();
    expect(document.querySelector(".ui-modal[open]")).toBeNull();
  });
});

describe("phone step sheet", () => {
  it("opens a step's editor and its rows-after-step table; the close control and Remove close it", async () => {
    await renderSpinePageSettled();
    await findStepRow(/Sort rows/);
    expect(queryStepSheet()).toBeNull();
    const sheet = openStepSheet(/Sort rows/);
    expect(within(sheet).getByRole("region", { name: "Step 2 Sort rows" })).toBeInTheDocument();
    expect(within(sheet).getByRole("region", { name: "Rows after step 2" })).toBeInTheDocument();
    expect(
      within(sheet).getByRole("button", { name: /^Step actions for Sort rows/ }),
    ).toBeVisible();
    await closeStepSheet();
    expect(queryStepSheet()).toBeNull();
  });

  it("sends a pending edit when the sheet closes (the editor flushes on unmount)", async () => {
    jest.mocked(updatePipelineStep).mockResolvedValue(threeSteps()[0]);
    await renderSpinePageSettled();
    await findStepRow(/Filter rows/);
    const sheet = openStepSheet(/Filter rows/);
    const value = within(sheet).getByDisplayValue("180");
    fireEvent.change(value, { target: { value: "200" } });
    expect(updatePipelineStep).not.toHaveBeenCalled();
    await closeStepSheet();
    await waitFor(() => expect(updatePipelineStep).toHaveBeenCalledTimes(1));
    expect(jest.mocked(updatePipelineStep).mock.calls[0][0]).toBe("s1");
  });

  it("keeps focus inside the sheet, on its Step actions trigger, after Move down from the sheet's menu", async () => {
    jest
      .mocked(reorderPipelineSteps)
      .mockResolvedValueOnce([threeSteps()[1], threeSteps()[0], threeSteps()[2]]);
    await renderSpinePageSettled();
    await findStepRow(/Filter rows/);
    const sheet = openStepSheet(/Filter rows/);
    const trigger = within(sheet).getByRole("button", { name: /^Step actions for Filter rows/ });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Move step down/ }));
    await waitFor(() => expect(reorderPipelineSteps).toHaveBeenCalled());
    expect(sheet).toHaveAttribute("open");
    expect(sheet.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  it("removing the open step closes its sheet", async () => {
    await renderSpinePageSettled();
    await findStepRow(/Filter rows/);
    jest.mocked(deletePipelineStep).mockResolvedValue(undefined);
    // The server's truth after the delete: the removed step's child is re-parented onto its predecessor.
    const [first, , third] = threeSteps();
    jest.mocked(getPipelineSteps).mockResolvedValue([first, { ...third, parentStepId: "s1" }]);
    const sheet = openStepSheet(/Sort rows/);
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Remove step" }));
    });
    await waitFor(() => expect(queryStepSheet()).toBeNull());
    expect(stepRows()).toHaveLength(2);
  });

  it("renders every step kind's editor (no 'Configure this ... step' fallback)", () => {
    // A tiny harness: the sheet primitive around the real focused editor for each registered op type.
    for (const opType of OP_TYPES) {
      const step = makeStep(opType);
      const { unmount } = renderWithStore(
        <BottomSheet open title="Edit step" ariaLabel="Step editor" onClosed={() => {}}>
          <StepCardFocused
            step={step}
            allSteps={[step]}
            isOwner
            stepNumber={1}
            onRemove={() => {}}
            analyzeColumns={[]}
            analyzeSchema={[{ name: "a", type: "string" }]}
            onConfigChange={() => {}}
            onToggleEnabled={() => {}}
            onDuplicate={() => {}}
            isDuplicating={false}
          />
        </BottomSheet>,
      );
      const sheet = stepSheet();
      expect(within(sheet).getByRole("region", { name: `Step 1 ${opType.label}` })).toBeVisible();
      expect(
        within(sheet).queryByText(new RegExp(`^Configure this ${opType.label.toLowerCase()} step`)),
      ).toBeNull();
      unmount();
    }
  });
});

describe("phone floating run pills", () => {
  it("float Dry run (opaque secondary) and the one accent Run pipeline; the draft slot is empty", async () => {
    await renderSpinePageSettled();
    const dry = screen.getByRole("button", { name: "Dry run" });
    const run = screen.getByRole("button", { name: "Run pipeline" });
    expect(run).toHaveClass("mobile-pill--primary");
    expect(dry).not.toHaveClass("mobile-pill--primary");
    expect(dry).toBeEnabled();
    expect(run).toBeEnabled();
    const slot = document.querySelector('[data-slot="draft-status"]');
    expect(slot).not.toBeNull();
    expect(slot).toBeEmptyDOMElement();
    // No footer bar any more.
    expect(document.querySelector(".pipeline-detail-page__footer")).toBeNull();
  });

  it.each(["queued", "running"] as const)(
    "both pills are disabled while a run is %s",
    async (runStatus) => {
      await renderSpinePageSettled(makeSpineStore({ runStatus }));
      expect(screen.getByRole("button", { name: "Dry run" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Run pipeline" })).toBeDisabled();
    },
  );

  it("publishes the bar's measured height as the body's bottom-clearance variable", async () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains("mobile-actions") ? 92 : 0;
      },
    });
    try {
      await renderSpinePageSettled();
      const page = document.querySelector(".pipeline-detail-page--mobile") as HTMLElement;
      expect(page.style.getPropertyValue(ACTIONS_HEIGHT_PROPERTY)).toBe("92px");
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, "offsetHeight", original);
      else delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
    }
  });
});

describe("phone layout retires the river", () => {
  it("renders no river, ribbon, footer, Outputs tab or desktop spine", async () => {
    await renderSpinePageSettled();
    for (const selector of [
      ".pipeline-detail-page__river",
      ".pipeline-detail-page__footer",
      ".pipeline-detail-header",
      ".pipeline-detail-page--spine",
    ]) {
      expect(document.querySelector(selector)).toBeNull();
    }
    expect(screen.queryByRole("tab", { name: /Outputs/ })).toBeNull();
  });
});
