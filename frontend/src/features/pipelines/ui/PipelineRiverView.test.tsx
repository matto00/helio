// PipelineRiverView.test.tsx — HEL-407 drag-drop + Move up/down reorder
// orchestration (design.md Decisions 5 & 6). Renders PipelineRiverView
// directly with a fixed 3-step fixture so the drop computation and the
// Move-button transposition/disable logic can be exercised without going
// through PipelineDetailPage's full data-fetch machinery. `onReorderSteps`
// is a jest mock — PipelineDetailPage.test.tsx covers what the page does
// with the callback (persistence, reconciliation, revert-on-failure).

import type { ComponentProps } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { PipelineRiverView } from "./PipelineRiverView";
import { OP_TYPES } from "../state/stepNarrowing";
import { buildStepTree } from "../state/stepTree";
import type { Step } from "../types/step";

const FILTER_OP = OP_TYPES.find((op) => op.id === "filter")!;
const LIMIT_OP = OP_TYPES.find((op) => op.id === "limit")!;
const SORT_OP = OP_TYPES.find((op) => op.id === "sort")!;
const CAST_OP = OP_TYPES.find((op) => op.id === "cast")!;

// Three distinctly-labeled persisted steps: A (filter), B (limit), C (sort).
const stepA: Step = {
  id: "a",
  opType: FILTER_OP,
  label: "Filter rows",
  config: { combinator: "AND", conditions: [] },
  enabled: true,
};
const stepB: Step = {
  id: "b",
  opType: LIMIT_OP,
  label: "Limit rows",
  config: { count: 100 },
  enabled: true,
};
const stepC: Step = {
  id: "c",
  opType: SORT_OP,
  label: "Sort rows",
  config: { sortBy: [] },
  enabled: true,
};
// Fourth step for the CR1 downward-multi-position regression fixture below.
const stepD: Step = {
  id: "d",
  opType: CAST_OP,
  label: "Cast type",
  config: { casts: {} },
  enabled: true,
};

function baseProps(overrides: Partial<ComponentProps<typeof PipelineRiverView>> = {}) {
  // HEL-908 task 3.4 — none of this file's fixture steps carry a
  // `parentStepId`, so `buildStepTree` degrades to the old flat trunk-only
  // behavior these pre-existing tests assert on (see `stepTree.ts`'s orphan
  // sweep). Derived from `overrides.steps` when present so an override that
  // swaps in a different fixture array still gets a matching tree.
  const resolvedSteps = overrides.steps ?? [stepA, stepB, stepC];
  return {
    steps: resolvedSteps,
    stepTree: buildStepTree(resolvedSteps),
    pipelineId: "pipe-1",
    dropdownOpen: false,
    openDropdown: jest.fn(),
    closeDropdown: jest.fn(),
    onAddStep: jest.fn(),
    onInsertStep: jest.fn(),
    onAddTailStep: jest.fn(),
    onRemoveStep: jest.fn(),
    getAnalyzeColumns: () => [],
    getAnalyzeSchema: () => [],
    getAnalyzeOutputSchema: () => [],
    getAnalyzeValidationError: () => undefined,
    onStepConfigChange: jest.fn(),
    runStepRowCounts: null,
    onInstantiateShape: jest.fn(async () => {}),
    onReorderSteps: jest.fn(),
    onToggleStepEnabled: jest.fn(),
    onDuplicateStep: jest.fn(),
    outputsByStepId: {},
    previewRowCountByOutputId: {},
    onOpenOutput: jest.fn(),
    onAddOutput: jest.fn(),
    ...overrides,
  };
}

/** The `.pipeline-detail-page__step-section` wrapper that owns the drop
 *  target (onDragOver/onDrop) for the card with the given accessible label. */
function sectionFor(label: string): HTMLElement {
  const toggle = screen.getByRole("button", { name: label });
  const section = toggle.closest(".pipeline-detail-page__step-section");
  if (section === null) throw new Error(`No step-section ancestor for "${label}"`);
  return section as HTMLElement;
}

/** design.md Decision 5 — the drag handle is `aria-hidden` (the Move
 *  buttons are the keyboard path), so it's queried by class, not role. */
function dragHandleFor(label: string): HTMLElement {
  const section = sectionFor(label);
  const handle = section.querySelector(".pipeline-detail-page__step-card-drag-handle");
  if (handle === null) throw new Error(`No drag handle found for "${label}"`);
  return handle as HTMLElement;
}

describe("PipelineRiverView drag-drop reorder (HEL-407 design.md Decision 5)", () => {
  it("drop handler computes the correct id order — dragging C above A", () => {
    const onReorderSteps = jest.fn();
    render(<PipelineRiverView {...baseProps({ onReorderSteps })} />);

    // Matches spec.md's concrete scenario: drag step C above step A and drop.
    fireEvent.dragStart(dragHandleFor("Sort rows"));
    fireEvent.dragOver(sectionFor("Filter rows"));
    fireEvent.drop(sectionFor("Filter rows"));

    expect(onReorderSteps).toHaveBeenCalledTimes(1);
    const newOrder = onReorderSteps.mock.calls[0][0] as Step[];
    expect(newOrder.map((s) => s.id)).toEqual(["c", "a", "b"]);
  });

  it("dropping onto the same index the dragged card started at is a no-op", () => {
    const onReorderSteps = jest.fn();
    render(<PipelineRiverView {...baseProps({ onReorderSteps })} />);

    fireEvent.dragStart(dragHandleFor("Filter rows"));
    fireEvent.dragOver(sectionFor("Filter rows"));
    fireEvent.drop(sectionFor("Filter rows"));

    expect(onReorderSteps).not.toHaveBeenCalled();
  });

  it("dragover without an active drag does not register a drop target (no preventDefault, no reorder on drop)", () => {
    const onReorderSteps = jest.fn();
    render(<PipelineRiverView {...baseProps({ onReorderSteps })} />);

    // No dragStart fired first — draggedIndex stays null.
    fireEvent.dragOver(sectionFor("Sort rows"));
    fireEvent.drop(sectionFor("Sort rows"));

    expect(onReorderSteps).not.toHaveBeenCalled();
  });

  // CR1 (evaluation-1.md) regression guard — the existing "dragging C above A"
  // test above only covers an *upward* drag, which was never broken. The
  // reported bug is specific to a *downward* drag spanning more than one
  // card: `handleCardDrop` passed the raw, pre-removal `overIndex` straight
  // through to `moveStep` as the final resting index, but removing the
  // dragged item shifts every later index down by one — so for
  // `draggedIndex < overIndex` the step landed one slot past where the
  // drop-indicator line was shown. Mirrors the evaluator's live repro
  // exactly: 4 steps [Limit, Filter, Sort, Cast], drag "Filter rows"
  // (index 1) down so the indicator renders above "Cast type" (index 3).
  it("drop handler computes the correct id order — dragging Filter down past Sort to hover over Cast (CR1)", () => {
    const onReorderSteps = jest.fn();
    render(
      <PipelineRiverView {...baseProps({ steps: [stepB, stepA, stepC, stepD], onReorderSteps })} />,
    );

    fireEvent.dragStart(dragHandleFor("Filter rows"));
    fireEvent.dragOver(sectionFor("Cast type"));
    fireEvent.drop(sectionFor("Cast type"));

    expect(onReorderSteps).toHaveBeenCalledTimes(1);
    const newOrder = onReorderSteps.mock.calls[0][0] as Step[];
    // Filter lands directly before Cast — where the drop-indicator line was
    // shown — not after it. Pre-fix this produced ["b", "c", "d", "a"].
    expect(newOrder.map((s) => s.id)).toEqual(["b", "c", "a", "d"]);
  });
});

describe("PipelineRiverView Move up/down (HEL-407 design.md Decision 6)", () => {
  it("disables Move up on the first card and Move down on the last card", () => {
    render(<PipelineRiverView {...baseProps()} />);

    expect(
      within(sectionFor("Filter rows")).getByRole("button", { name: "Move step up" }),
    ).toBeDisabled();
    expect(
      within(sectionFor("Filter rows")).getByRole("button", { name: "Move step down" }),
    ).toBeEnabled();

    expect(
      within(sectionFor("Sort rows")).getByRole("button", { name: "Move step down" }),
    ).toBeDisabled();
    expect(
      within(sectionFor("Sort rows")).getByRole("button", { name: "Move step up" }),
    ).toBeEnabled();
  });

  it("enables both Move buttons on a middle card", () => {
    render(<PipelineRiverView {...baseProps()} />);

    expect(
      within(sectionFor("Limit rows")).getByRole("button", { name: "Move step up" }),
    ).toBeEnabled();
    expect(
      within(sectionFor("Limit rows")).getByRole("button", { name: "Move step down" }),
    ).toBeEnabled();
  });

  it("Move step up transposes the middle card with its predecessor", () => {
    const onReorderSteps = jest.fn();
    render(<PipelineRiverView {...baseProps({ onReorderSteps })} />);

    fireEvent.click(within(sectionFor("Limit rows")).getByRole("button", { name: "Move step up" }));

    expect(onReorderSteps).toHaveBeenCalledTimes(1);
    const newOrder = onReorderSteps.mock.calls[0][0] as Step[];
    expect(newOrder.map((s) => s.id)).toEqual(["b", "a", "c"]);
  });

  it("Move step down transposes the middle card with its successor", () => {
    const onReorderSteps = jest.fn();
    render(<PipelineRiverView {...baseProps({ onReorderSteps })} />);

    fireEvent.click(
      within(sectionFor("Limit rows")).getByRole("button", { name: "Move step down" }),
    );

    expect(onReorderSteps).toHaveBeenCalledTimes(1);
    const newOrder = onReorderSteps.mock.calls[0][0] as Step[];
    expect(newOrder.map((s) => s.id)).toEqual(["a", "c", "b"]);
  });
});

describe("PipelineRiverView insert-at-position (HEL-410 design.md Decision 5)", () => {
  it("renders one gap insert button per step, including before the first step", () => {
    render(<PipelineRiverView {...baseProps()} />);

    // 3 steps -> 3 gaps: before A, between A/B, between B/C. After-last stays
    // the existing "+ Add transformation step" row, not a gap button.
    expect(screen.getAllByRole("button", { name: "Insert step here" })).toHaveLength(3);
  });

  it("clicking a gap button opens the op picker anchored at that gap", () => {
    render(<PipelineRiverView {...baseProps()} />);

    const gapButtons = screen.getAllByRole("button", { name: "Insert step here" });
    fireEvent.click(gapButtons[1]); // gap between Filter and Limit

    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("selecting an op from a gap's dropdown invokes onInsertStep with that gap's index", () => {
    const onInsertStep = jest.fn();
    render(<PipelineRiverView {...baseProps({ onInsertStep })} />);

    const gapButtons = screen.getAllByRole("button", { name: "Insert step here" });
    fireEvent.click(gapButtons[1]); // gap index 1 (between Filter and Limit)
    fireEvent.click(screen.getByRole("menuitem", { name: /Cast type/i }));

    expect(onInsertStep).toHaveBeenCalledTimes(1);
    const [opType, index] = onInsertStep.mock.calls[0];
    expect(opType.id).toBe("cast");
    expect(index).toBe(1);
  });

  it("opening the bottom add-step dropdown closes an open gap dropdown, and vice versa", () => {
    const closeDropdown = jest.fn();
    const openDropdown = jest.fn();
    render(<PipelineRiverView {...baseProps({ closeDropdown, openDropdown })} />);

    const gapButtons = screen.getAllByRole("button", { name: "Insert step here" });
    fireEvent.click(gapButtons[0]);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(closeDropdown).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "+ Add transformation step" }));
    expect(openDropdown).toHaveBeenCalledTimes(1);
    // The gap dropdown closed as part of the bottom-row open (only one
    // dropdown at a time); `dropdownOpen` itself stays parent-controlled
    // (a mock here), so no menu remains mounted from either picker.
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

// HEL-412 — RiverView delegates the disable/enable toggle and duplicate
// actions straight through to the page (persistence lives there, mirroring
// onRemoveStep/onReorderSteps); it also computes `enabledBits` from its own
// `steps` prop and threads the same string to every card.
describe("PipelineRiverView disable/duplicate delegation (HEL-412)", () => {
  it("clicking Disable step on a card invokes onToggleStepEnabled(stepId, false)", () => {
    const onToggleStepEnabled = jest.fn();
    render(<PipelineRiverView {...baseProps({ onToggleStepEnabled })} />);

    fireEvent.click(within(sectionFor("Limit rows")).getByRole("button", { name: "Disable step" }));

    expect(onToggleStepEnabled).toHaveBeenCalledWith("b", false);
  });

  it("a disabled step's card shows Enable step (label reflects the next state)", () => {
    render(
      <PipelineRiverView {...baseProps({ steps: [stepA, { ...stepB, enabled: false }, stepC] })} />,
    );

    expect(
      within(sectionFor("Limit rows")).getByRole("button", { name: "Enable step" }),
    ).toBeInTheDocument();
  });

  it("clicking Duplicate step on a card invokes onDuplicateStep(stepId)", () => {
    const onDuplicateStep = jest.fn();
    render(<PipelineRiverView {...baseProps({ onDuplicateStep })} />);

    fireEvent.click(
      within(sectionFor("Filter rows")).getByRole("button", { name: "Duplicate step" }),
    );

    expect(onDuplicateStep).toHaveBeenCalledWith("a");
  });
});

// skeptic-final-2 (round 1) CR1 — the bottom "Add Outputs from a shape"
// trigger always anchors on the trunk-last step; that anchor already having
// a tail is exactly the state that made the OLD handler create a second,
// dead tail branch (see usePipelineDetailPage.ts's handleInstantiateShape
// doc comment). The trigger must be disabled in that state, not merely
// "handled" post-hoc by the handler.
describe("PipelineRiverView shape-picker trunk-last-tail gate (skeptic-final-2 round 1 CR1)", () => {
  it("enables 'Add Outputs from a shape' when the trunk-last step has no tail", () => {
    render(<PipelineRiverView {...baseProps()} />);
    expect(screen.getByRole("button", { name: "Add Outputs from a shape" })).toBeEnabled();
  });

  it("disables 'Add Outputs from a shape' when the trunk-last step already has a tail", () => {
    // Unlike this file's default flat fixture (no `parentStepId` at all —
    // see `baseProps`'s doc comment), a real trunk chain must be linked via
    // `parentStepId` for `buildStepTree` to derive a tail at all.
    const linkedA: Step = { ...stepA, parentStepId: undefined };
    const linkedB: Step = { ...stepB, parentStepId: "a", position: 0 };
    const linkedC: Step = { ...stepC, parentStepId: "b", position: 0 };
    const tail: Step = { ...stepD, id: "t", parentStepId: "c", position: 1 };
    const steps = [linkedA, linkedB, linkedC, tail];
    render(<PipelineRiverView {...baseProps({ steps, stepTree: buildStepTree(steps) })} />);
    expect(screen.getByRole("button", { name: "Add Outputs from a shape" })).toBeDisabled();
  });
});
