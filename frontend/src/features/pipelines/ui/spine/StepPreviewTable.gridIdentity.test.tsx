// HEL-1809 (design.md D4/D5 iv): the first edit of a pipeline switches StepPreviewTable from the saved rows to the draft rows.
// Both are the same grid, so its DOM node (and its scroll position and its layout measurement) must survive the switch in
// both directions instead of being rebuilt. Counts DOM identity, never time.

import { act, render, screen } from "@testing-library/react";

import type { Frame } from "../../evaluator";
import { decodeRow } from "../../evaluator/wire";
import { fetchStepPreview } from "../../services/pipelineService";
import { createInFlightDedupe } from "../../state/inFlightDedupe";
import type { DraftStepView } from "../../state/draftStepView";
import { OP_TYPES } from "../../state/stepNarrowing";
import type { Step } from "../../types/step";
import { StepPreviewTable, type StepPreviewDraft } from "./StepPreviewTable";

jest.mock("../../services/pipelineService", () => ({ fetchStepPreview: jest.fn() }));

const STEP: Step = {
  id: "s1",
  opType: OP_TYPES.find((op) => op.id === "filter")!,
  label: "Filter rows",
  config: { combinator: "and", conditions: [] },
  enabled: true,
  rootId: "r1",
};
const dedupe = createInFlightDedupe();
const frame = (...rows: Array<Record<string, unknown>>): Frame => rows.map(decodeRow);

function draftOf(rows: Frame): StepPreviewDraft {
  const view: DraftStepView = {
    status: "ok",
    count: rows.length,
    rows,
    frameStale: false,
    message: null,
  };
  return {
    active: true,
    view,
    savedStep: STEP,
    baseRows: undefined,
    savedCache: { store: new Map(), key: "k" },
  };
}

function ui(draft: StepPreviewDraft | undefined) {
  return (
    <StepPreviewTable
      pipelineId="p1"
      step={STEP}
      draft={draft}
      stepNumber={1}
      stepIndex={0}
      enabledBits="1"
      analyzeSchema={[]}
      analyzeOutputSchema={[{ name: "n", type: "number" }]}
      hasOwnAnalyze={false}
      isCreating={false}
      dedupe={dedupe}
      beforeFetch={() => Promise.resolve()}
    />
  );
}

describe("StepPreviewTable keeps one grid mounted across the saved/draft switch (HEL-1809)", () => {
  beforeEach(() => {
    jest.mocked(fetchStepPreview).mockResolvedValue({ rows: [{ n: 1 }, { n: 2 }], rowCount: 2 });
  });

  it("keeps the same grid DOM node when the first edit turns the saved rows into the draft rows, and back", async () => {
    const { container, rerender } = render(ui(undefined));
    await screen.findByText("2 rows", undefined, { timeout: 4000 });
    const saved = container.querySelector("table");
    expect(saved).not.toBeNull();

    rerender(ui(draftOf(frame({ n: 1 }, { n: 2 }, { n: 3 }))));
    await act(async () => undefined);
    expect(container.querySelector("table")).toBe(saved);
    expect(screen.getByText("3 rows")).toBeInTheDocument();

    rerender(ui(undefined));
    await act(async () => undefined);
    expect(container.querySelector("table")).toBe(saved);
  });
});
