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
import { renderWithStore } from "../../../test/renderWithStore";
import { OP_TYPES } from "../state/stepNarrowing";
import { buildLaneGraph } from "../state/stepTree";
import type { PipelineRoot } from "../types/pipelineStep";
import type { Step } from "../types/step";

// AddRootModal (mounted lazily by "+ Add root") fetches sources on open --
// mocked so it never hits a real (jsdom-network-error) request.
jest.mock("../../sources/services/dataSourceService", () => ({
  fetchSources: jest.fn().mockResolvedValue([]),
}));

/** HEL-912 — this file's fixtures historically had no `parentStepId` at
 *  all, relying on the OLD `buildStepTree`'s "append any parentless step
 *  after the first to the trunk in array order" fallback. `buildLaneGraph`
 *  generalizes that fallback into a totality sweep that gives each
 *  unreached parentless step its OWN singleton lane instead (task 1.2) --
 *  correct for real orphaned data, but no longer flattens multiple
 *  intentionally-sequential fixture steps into one lane. Auto-link each
 *  step (that doesn't already carry an explicit `parentStepId`) to the
 *  PREVIOUS step in array order, reproducing the old flat single-lane
 *  shape these reorder/Move tests actually exercise. */
function linkChain(steps: Step[]): Step[] {
  const linked: Step[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    linked.push(s.parentStepId !== undefined ? s : { ...s, parentStepId: linked[i - 1]?.id });
  }
  return linked;
}

const FILTER_OP = OP_TYPES.find((op) => op.id === "filter")!;
const LIMIT_OP = OP_TYPES.find((op) => op.id === "limit")!;
const SORT_OP = OP_TYPES.find((op) => op.id === "sort")!;
const CAST_OP = OP_TYPES.find((op) => op.id === "cast")!;
const ONE_ROOT: PipelineRoot[] = [
  { id: "root-1", dataSourceId: "src-1", dataSourceName: "Test source" },
];

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
  // HEL-912 — `linkChain` (see top of file) auto-links this file's
  // fixture steps into one primary lane. Derived from `overrides.steps`
  // when present so an override that swaps in a different fixture array
  // still gets a matching graph.
  const resolvedSteps = linkChain(overrides.steps ?? [stepA, stepB, stepC]);
  return {
    steps: resolvedSteps,
    laneGraph: buildLaneGraph(resolvedSteps, ONE_ROOT),
    roots: ONE_ROOT,
    onAddRoot: jest.fn(),
    onRemoveRoot: jest.fn(),
    pipelineId: "pipe-1",
    dropdownOpen: false,
    openDropdown: jest.fn(),
    closeDropdown: jest.fn(),
    onAddStep: jest.fn(),
    onInsertStep: jest.fn(),
    onAddLaneStep: jest.fn(),
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

// HEL-912 (design.md Decision 1) — the skeptic-final-2 trunk-last-tail gate
// this used to test is GONE: a node with several children just roots
// several lanes now, so "Add Outputs from a shape" is never disabled by an
// existing lane off the anchor.
describe("PipelineRiverView shape-picker (HEL-912 — single-tail gate removed)", () => {
  it("'Add Outputs from a shape' stays enabled even when the last primary-lane step already has a lane", () => {
    const linkedA: Step = { ...stepA, parentStepId: undefined };
    const linkedB: Step = { ...stepB, parentStepId: "a", position: 0 };
    const linkedC: Step = { ...stepC, parentStepId: "b", position: 0 };
    const lane: Step = { ...stepD, id: "t", parentStepId: "c", position: 1 };
    const steps = [linkedA, linkedB, linkedC, lane];
    render(
      <PipelineRiverView {...baseProps({ steps, laneGraph: buildLaneGraph(steps, ONE_ROOT) })} />,
    );
    expect(screen.getByRole("button", { name: "Add Outputs from a shape" })).toBeEnabled();
  });
});

// HEL-912 task 3.3/3.5 — pins the two properties `pipeline-tails-ui` states
// for a one-step lane's compact rendering (there are no frontend Jest
// snapshots, per design.md's Risks/Trade-offs): the indented dashed
// `.pipeline-detail-page__tail-chain-item` connector, and its termination
// in the step's own card. This is a GUARD, not a proof of pixel identity —
// see `files-modified.md` for the mutation that makes it fail (lesson 5:
// one mutation, not a conjunction).
describe("PipelineRiverView one-step lane compact rendering (HEL-912 task 3.3)", () => {
  it("a one-step lane off a primary step renders via .pipeline-detail-page__tail-chain-item, nested under that step's section", () => {
    // `a` needs TWO children for either to root its own lane (design.md
    // Decision 1 — a lane continues through single-child edges, so a
    // single child never splits off on its own); `stepC` is the primary
    // lane's own continuation, `stepB` roots a one-step lane off `a`.
    const linkedA: Step = { ...stepA, parentStepId: undefined };
    const primaryContinuation: Step = { ...stepC, parentStepId: "a", position: 0 };
    const lane: Step = { ...stepB, parentStepId: "a", position: 1 };
    const steps = [linkedA, primaryContinuation, lane];
    render(
      <PipelineRiverView {...baseProps({ steps, laneGraph: buildLaneGraph(steps, ONE_ROOT) })} />,
    );

    const aSection = sectionFor("Filter rows");
    const tailItems = within(aSection).getAllByRole("button", { name: "Limit rows" });
    expect(tailItems).toHaveLength(1);
    const tailItemEl = tailItems[0].closest(".pipeline-detail-page__tail-chain-item");
    expect(tailItemEl).not.toBeNull();
    expect(tailItemEl!.querySelector(".pipeline-detail-page__tail-chain-connector")).not.toBeNull();
  });
});

// HEL-912 task 4.3 — "+ lane" (formerly "+ tail") is now unconditional: a
// step can gain a second AND third lane, with no refusal message.
describe("PipelineRiverView '+ lane' affordance (HEL-912 task 4.3)", () => {
  it("adding a second lane to the same step succeeds and renders, no refusal message", () => {
    const onAddLaneStep = jest.fn();
    const linkedA: Step = { ...stepA, parentStepId: undefined };
    const laneOne: Step = { ...stepB, parentStepId: "a", position: 1 };
    const steps = [linkedA, laneOne];
    render(
      <PipelineRiverView
        {...baseProps({ steps, laneGraph: buildLaneGraph(steps, ONE_ROOT), onAddLaneStep })}
      />,
    );

    const branchButtons = screen.getAllByRole("button", { name: /Branch this step/i });
    // One "+ lane" affordance per step (A's own, and B's own inside its
    // compact lane rendering) — click A's.
    fireEvent.click(branchButtons[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: /Sort rows/i }));

    expect(onAddLaneStep).toHaveBeenCalledTimes(1);
    const [opType, parentStepId] = onAddLaneStep.mock.calls[0];
    expect(opType.id).toBe("sort");
    expect(parentStepId).toBe("a");
    expect(screen.queryByText(/already has a tail/i)).not.toBeInTheDocument();
  });

  it("adding a third lane to the same step also succeeds, no refusal message", () => {
    const onAddLaneStep = jest.fn();
    const linkedA: Step = { ...stepA, parentStepId: undefined };
    const laneOne: Step = { ...stepB, parentStepId: "a", position: 1 };
    const laneTwo: Step = { ...stepC, parentStepId: "a", position: 2 };
    const steps = [linkedA, laneOne, laneTwo];
    render(
      <PipelineRiverView
        {...baseProps({ steps, laneGraph: buildLaneGraph(steps, ONE_ROOT), onAddLaneStep })}
      />,
    );

    const branchButtons = screen.getAllByRole("button", { name: /Branch this step/i });
    fireEvent.click(branchButtons[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: /Cast type/i }));

    expect(onAddLaneStep).toHaveBeenCalledTimes(1);
    expect(onAddLaneStep.mock.calls[0][1]).toBe("a");
    expect(screen.queryByText(/already has a tail/i)).not.toBeInTheDocument();
  });
});

// HEL-968 — root columns (task 6), "+ root" (task 8), root removal (task 9).
describe("PipelineRiverView — multi-root (HEL-968)", () => {
  const TWO_ROOTS: PipelineRoot[] = [
    { id: "root-1", dataSourceId: "src-1", dataSourceName: "Orders" },
    { id: "root-2", dataSourceId: "src-2", dataSourceName: "Shipments" },
  ];

  it("renders a column head per root, labelled with its dataSourceName -- neither styled as primary", () => {
    const steps = linkChain([stepA]);
    render(
      <PipelineRiverView
        {...baseProps({ steps, laneGraph: buildLaneGraph(steps, TWO_ROOTS), roots: TWO_ROOTS })}
      />,
    );
    expect(screen.getByText("Shipments")).toBeInTheDocument();
    expect(screen.queryByText(/primary/i)).not.toBeInTheDocument();
  });

  // task 6.2 — an empty root renders an affordance rather than vanishing.
  it("an empty root's column renders an empty-lane affordance instead of disappearing", () => {
    const steps = linkChain([stepA]);
    render(
      <PipelineRiverView
        {...baseProps({ steps, laneGraph: buildLaneGraph(steps, TWO_ROOTS), roots: TWO_ROOTS })}
      />,
    );
    expect(
      screen.getByText(/No steps yet/i, { selector: ".pipeline-detail-page__root-column-empty" }),
    );
  });

  it("clicking a root's Remove button invokes onRemoveRoot with that root's id", () => {
    const onRemoveRoot = jest.fn();
    const steps = linkChain([stepA]);
    render(
      <PipelineRiverView
        {...baseProps({
          steps,
          laneGraph: buildLaneGraph(steps, TWO_ROOTS),
          roots: TWO_ROOTS,
          onRemoveRoot,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Remove root Shipments/i }));
    expect(onRemoveRoot).toHaveBeenCalledWith("root-2");
  });

  it("'+ Add root' opens the add-root modal", () => {
    // jsdom does not implement showModal/close natively; stub to set the
    // open attribute (matching CreatePipelineModal.test.tsx's precedent).
    HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    });
    // AddRootModal reads/dispatches Redux (`useAppSelector`/`fetchSources`),
    // unlike the rest of this component -- needs a real store, unlike every
    // other test in this file.
    renderWithStore(<PipelineRiverView {...baseProps({ roots: ONE_ROOT })} />, {
      sources: { items: [], status: "succeeded" },
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Add root" }));
    expect(screen.getByRole("heading", { name: "Add a root" })).toBeInTheDocument();
  });
});

// HEL-985 — the round-2 skeptic on HEL-968 caught nodePath() shipping
// correct, unit-tested, and with ZERO call sites: no lane path rendered
// anywhere, so no gate (lint/typecheck/2636 Jest tests) noticed. This guard
// asserts on RENDERED output (a step's `title` attribute), not on
// `nodePath()`'s return value, across all four prop-threading edges
// (design.md Context/D4): E1 (PipelineRiverView.tsx:381, the trunk), E2
// (PipelineRiverView.tsx:461, a trunk step's own child lane, compact and
// non-compact), E3 (PipelineRiverView.tsx:539 -> RootColumn.tsx:114, a
// second root's own lane), E4 (LaneColumn.tsx:146, a lane nested under
// another lane).
//
// Deliberately does NOT go through `baseProps`/`linkChain`: `linkChain`
// auto-links any step with `parentStepId === undefined` to the PREVIOUS
// array element, which would silently chain root 2's parentless head step
// onto root 1's tail and collapse this fixture to one root (design.md
// Context, trap 2). Every step below carries an explicit `parentStepId`
// (or explicit `rootId` for a root head) and is passed straight to
// `PipelineRiverView`, bypassing `baseProps` entirely.
describe("nodePath wiring (HEL-985)", () => {
  const WIRING_OP = FILTER_OP; // op type is irrelevant to nodePath; reuse an existing OP_TYPES entry.

  /** Builds a fixture step with an explicit `parentStepId` (or `undefined`
   *  for a root head, paired with `rootId`) and an explicit `position` at
   *  every branch point (design.md Context trap 3 — `buildLaneGraph`
   *  silently mis-shapes the tree on an implicit/omitted `position`). */
  function wiringStep(
    id: string,
    label: string,
    parentStepId: string | undefined,
    opts: { position?: number; rootId?: string } = {},
  ): Step {
    return {
      id,
      opType: WIRING_OP,
      label,
      config: { combinator: "AND", conditions: [] },
      enabled: true,
      parentStepId,
      position: opts.position,
      rootId: opts.rootId,
    };
  }

  // Root 1's trunk: r1a (base case, directly on the root) -> r1b -> r1c
  // (multi-hop chain, two hops from r1a). Each continuation child carries
  // `position: 0` per design.md's branch-point rule.
  const r1a = wiringStep("r1a", "Trunk one", undefined, { rootId: "root-1" });
  const r1b = wiringStep("r1b", "Trunk two", "r1a", { position: 0 });
  const r1c = wiringStep("r1c", "Trunk three", "r1b", { position: 0 });
  // A single-step child lane off trunk step r1b (E2, compact site
  // LaneColumn.tsx:171 — the ONLY shape that renders it at all).
  const lane1a = wiringStep("lane1a", "Solo lane step", "r1b", { position: 1 });
  // A >=2-step child lane off trunk step r1c (E2, non-compact site
  // LaneColumn.tsx:216). r1c has no position-0 child, so the trunk
  // terminates at r1c and laneA/laneB form their own lane.
  const laneA = wiringStep("laneA", "Two lane first", "r1c", { position: 1 });
  const laneB = wiringStep("laneB", "Two lane second", "laneA", { position: 0 });
  // A lane NESTED under laneA/laneB's lane (E4 — LaneColumn.tsx:146, only
  // reachable from inside another LaneColumn's own renderChildLanes).
  const laneC = wiringStep("laneC", "Nested lane step", "laneB", { position: 1 });
  // Root 2's own lane (E3 — PipelineRiverView.tsx:539 -> RootColumn.tsx:114),
  // carrying the distinct `root:root-2` head a single-root fixture cannot
  // produce.
  const r2a = wiringStep("r2a", "Root two step", undefined, { rootId: "root-2" });

  const WIRING_STEPS: Step[] = [r1a, r1b, r1c, lane1a, laneA, laneB, laneC, r2a];
  const WIRING_ROOTS: PipelineRoot[] = [
    { id: "root-1", dataSourceId: "src-1", dataSourceName: "Root One Source" },
    { id: "root-2", dataSourceId: "src-2", dataSourceName: "Root Two Source" },
  ];

  /** Full `PipelineRiverView` props, built directly (NOT via `baseProps`,
   *  see the describe-level comment) so `linkChain` never touches these
   *  explicit-`parentStepId` steps. */
  function wiringProps(): ComponentProps<typeof PipelineRiverView> {
    return {
      steps: WIRING_STEPS,
      laneGraph: buildLaneGraph(WIRING_STEPS, WIRING_ROOTS),
      roots: WIRING_ROOTS,
      onAddRoot: jest.fn(),
      onRemoveRoot: jest.fn(),
      pipelineId: "pipe-wiring",
      dropdownOpen: false,
      openDropdown: jest.fn(),
      closeDropdown: jest.fn(),
      onAddStep: jest.fn(),
      onInsertStep: jest.fn(),
      onAddLaneStep: jest.fn(),
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
    };
  }

  /** D3 — locate a step by its visible label, then walk to the nearest
   *  ancestor carrying `title`. Never `getByTitle`: that makes the query
   *  itself the assertion, producing an "unable to find element" failure
   *  indistinguishable from an unrelated fixture break. */
  function titleFor(label: string): string {
    const labelEl = screen.getByText(label);
    const withTitle = labelEl.closest("[title]");
    if (withTitle === null) throw new Error(`No title-bearing ancestor for "${label}"`);
    return withTitle.getAttribute("title") ?? "";
  }

  it("renders the expected shape before any title is asserted (design.md risk 1)", () => {
    render(<PipelineRiverView {...wiringProps()} />);

    // task 1.2 — do NOT count root columns (root 1 never renders as one, and
    // the "+ root" pseudo-column shares its class). Probe by label instead.
    expect(screen.getByLabelText("Root: Root Two Source")).toBeInTheDocument();
    // Root 1's trunk steps render outside any RootColumn.
    expect(screen.getByText("Trunk one")).toBeInTheDocument();
    expect(screen.getByText("Trunk three")).toBeInTheDocument();

    // Two non-compact lanes ("Lane"): the >=2-step lane off r1c, and root
    // 2's own lane via RootColumn. Two compact lanes ("Tail steps"): the
    // single-step lane off r1b, and the lane nested under laneA/laneB.
    expect(screen.getAllByLabelText("Lane")).toHaveLength(2);
    expect(screen.getAllByLabelText("Tail steps")).toHaveLength(2);
  });

  it("renders the base-case title on a step directly on root 1 (E1, PipelineRiverView.tsx:381)", () => {
    render(<PipelineRiverView {...wiringProps()} />);
    expect(titleFor("Trunk one")).toBe("root:root-1 > r1a");
  });

  it("renders the multi-hop chain title, pinning hop order and the separator (E1)", () => {
    render(<PipelineRiverView {...wiringProps()} />);
    expect(titleFor("Trunk three")).toBe("root:root-1 > r1a > r1b > r1c");
  });

  it("renders the title on a single-step child lane off a trunk step (E2, compact site LaneColumn.tsx:171)", () => {
    render(<PipelineRiverView {...wiringProps()} />);
    expect(titleFor("Solo lane step")).toBe("root:root-1 > r1a > r1b > lane1a");
  });

  it("renders the title on a >=2-step child lane off a trunk step (E2, non-compact site LaneColumn.tsx:216)", () => {
    render(<PipelineRiverView {...wiringProps()} />);
    expect(titleFor("Two lane first")).toBe("root:root-1 > r1a > r1b > r1c > laneA");
  });

  it("renders the title on a step inside a lane nested under another lane (E4, LaneColumn.tsx:146)", () => {
    render(<PipelineRiverView {...wiringProps()} />);
    expect(titleFor("Nested lane step")).toBe(
      "root:root-1 > r1a > r1b > r1c > laneA > laneB > laneC",
    );
  });

  it("renders a distinct root:root-2-headed title inside root 2's own lane (E3, RootColumn.tsx:114)", () => {
    render(<PipelineRiverView {...wiringProps()} />);
    expect(titleFor("Root two step")).toBe("root:root-2 > r2a");
  });
});
