// HEL-1631 (design.md D8, DESIGN.md §11): the changed-row flash. Rows of the step's new draft frame that were not in its
// previous frame carry `step-preview__cell--changed`; the first frame is compared with the saved pipeline's rows for the
// same step; a step switch (a fresh mount) never flashes; a frame more than FLASH_ROW_CAP rows new flashes nothing.

import { render } from "@testing-library/react";

import type { Frame } from "../../evaluator";
import { decodeRow } from "../../evaluator/wire";
import { createInFlightDedupe } from "../../state/inFlightDedupe";
import type { DraftStepView } from "../../state/draftStepView";
import { OP_TYPES } from "../../state/stepNarrowing";
import type { Step } from "../../types/step";
import { StepPreviewTable, type StepPreviewDraft } from "./StepPreviewTable";

jest.mock("../../services/pipelineService", () => ({ fetchStepPreview: jest.fn() }));

const frame = (...rows: Array<Record<string, unknown>>): Frame => rows.map(decodeRow);
const rowsN = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, i) => ({ n: from + i }));

const STEP: Step = {
  id: "s1",
  opType: OP_TYPES.find((op) => op.id === "filter")!,
  label: "Filter rows",
  config: { combinator: "and", conditions: [] },
  enabled: true,
  rootId: "r1",
};
const dedupe = createInFlightDedupe();

function draftOf(rows: Frame, baseRows?: Frame): StepPreviewDraft {
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
    baseRows,
    savedCache: { store: new Map(), key: "k" },
  };
}

function ui(draft: StepPreviewDraft, id = "s1") {
  return (
    <StepPreviewTable
      key={id}
      pipelineId="p1"
      step={{ ...STEP, id }}
      draft={draft}
      stepNumber={1}
      stepIndex={0}
      enabledBits="1"
      analyzeSchema={[]}
      analyzeOutputSchema={[]}
      hasOwnAnalyze={false}
      isCreating={false}
      dedupe={dedupe}
      beforeFetch={() => Promise.resolve()}
    />
  );
}

const changed = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("td.step-preview__cell--changed")).map(
    (td) => td.textContent,
  );

describe("StepPreviewTable changed-row flash", () => {
  it("compares the first draft frame with the saved rows: only rows not saved are marked", () => {
    const { container } = render(ui(draftOf(frame(...rowsN(0, 6)), frame(...rowsN(0, 3)))));
    expect(changed(container)).toEqual(["3", "4", "5"]);
  });

  it("marks exactly the rows new against the PREVIOUS frame on the next draft frame", () => {
    const { container, rerender } = render(
      ui(draftOf(frame(...rowsN(0, 4)), frame(...rowsN(0, 4)))),
    );
    expect(changed(container)).toEqual([]);
    rerender(ui(draftOf(frame(...rowsN(2, 8)), frame(...rowsN(0, 4)))));
    expect(changed(container)).toEqual(["4", "5", "6", "7"]);
  });

  it("never flashes without saved rows to compare the first frame with", () => {
    const { container } = render(ui(draftOf(frame(...rowsN(0, 5)))));
    expect(changed(container)).toEqual([]);
  });

  it("does not flash on a step switch: the table mounts fresh and the first frame has nothing to compare", () => {
    const { container, rerender } = render(
      ui(draftOf(frame(...rowsN(0, 4)), frame(...rowsN(0, 2)))),
    );
    expect(changed(container)).toEqual(["2", "3"]);
    rerender(ui(draftOf(frame(...rowsN(10, 14))), "s2"));
    expect(changed(container)).toEqual([]);
  });

  it("flashes nothing when more than 200 rows are new (whole-table churn)", () => {
    const { container } = render(ui(draftOf(frame(...rowsN(0, 260)), frame(...rowsN(0, 1)))));
    // Only the first 50 rows are rendered, all new; 259 new rows is over the cap of 200.
    expect(container.querySelectorAll("tbody tr").length).toBe(50);
    expect(changed(container)).toEqual([]);
  });

  it("still flashes the visible rows when 150 rows are new, just under the cap", () => {
    const { container } = render(ui(draftOf(frame(...rowsN(0, 151)), frame(...rowsN(0, 1)))));
    expect(container.querySelectorAll("tbody tr").length).toBe(50);
    expect(changed(container)).toHaveLength(49);
  });
});
