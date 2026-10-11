// GUARD (not a red-first regression): HEL-1484 collapsed three module-level `EMPTY_OUTPUTS`
// sentinels into one (`state/outputsSlice.ts`). Identity already held per copy, so this test is a
// guard: a step with zero Outputs must hand `StepCard` the SAME shared sentinel on every render,
// at all three call sites, or the React.memo'd card re-renders on every parent render (F-146).
//   - PipelineRiverView.tsx  : a step in a root's primary lane (`laneGraph.lanes[0]`)
//   - LaneColumn.tsx ~238    : a child lane with exactly ONE step (`isCompact` -> tail-chain branch)
//   - LaneColumn.tsx ~295    : a child lane with TWO+ steps (the full lane-column branch)
// Verified by mutation: replacing the sentinel with an inline `[]` at each site separately turns
// the matching assertion red (see the HEL-1484 evidence dir).

import type { ComponentProps } from "react";
import { render } from "@testing-library/react";

import { PipelineRiverView } from "./PipelineRiverView";
import { EMPTY_OUTPUTS } from "../state/outputsSlice";
import { OP_TYPES } from "../state/stepNarrowing";
import { buildLaneGraph } from "../state/stepTree";
import type { PipelineRoot } from "../types/pipelineStep";
import type { Step } from "../types/step";
import type { Output } from "../types/output";

const mockStepCardOutputs: Record<string, Output[][]> = {};
jest.mock("./StepCard", () => ({
  StepCard: (props: { step: { id: string }; outputs: Output[] }) => {
    (mockStepCardOutputs[props.step.id] ??= []).push(props.outputs);
    return <div data-testid={`step-${props.step.id}`} />;
  },
}));

const LIMIT_OP = OP_TYPES.find((op) => op.id === "limit")!;
const ONE_ROOT: PipelineRoot[] = [
  { id: "root-1", dataSourceId: "src-1", dataSourceName: "Test source" },
];

function step(id: string, parentStepId?: string): Step {
  return {
    id,
    opType: LIMIT_OP,
    label: `Limit ${id}`,
    config: { count: 1 },
    enabled: true,
    parentStepId,
  };
}

// Primary lane: trunk -> trunk2. Compact child lane off `trunk`: just `solo`. Full child lane
// off `trunk`: `pair1` -> `pair2`.
const STEPS: Step[] = [
  step("trunk"),
  step("trunk2", "trunk"),
  step("solo", "trunk"),
  step("pair1", "trunk"),
  step("pair2", "pair1"),
];

function props(): ComponentProps<typeof PipelineRiverView> {
  return {
    steps: STEPS,
    laneGraph: buildLaneGraph(STEPS, ONE_ROOT),
    roots: ONE_ROOT,
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
    duplicatingStepIds: new Set<string>(),
    outputsByStepId: {},
    previewRowCountByOutputId: {},
    onOpenOutput: jest.fn(),
    onAddOutput: jest.fn(),
  };
}

describe("EMPTY_OUTPUTS identity guard (HEL-1484)", () => {
  // One render + one re-render (fresh `outputsByStepId` object, still no Outputs).
  function renderTwice() {
    for (const id of Object.keys(mockStepCardOutputs)) delete mockStepCardOutputs[id];
    const view = render(<PipelineRiverView {...props()} />);
    view.rerender(<PipelineRiverView {...props()} />);
  }

  it.each([
    ["PipelineRiverView primary-lane step", "trunk"],
    ["LaneColumn compact (tail-chain) step", "solo"],
    ["LaneColumn full lane-column step", "pair1"],
  ])("%s receives the shared EMPTY_OUTPUTS on every render", (_site, stepId) => {
    renderTwice();
    const seen = mockStepCardOutputs[stepId];
    expect(seen.length).toBeGreaterThanOrEqual(2);
    for (const outputs of seen) expect(outputs).toBe(EMPTY_OUTPUTS);
    expect(new Set(seen).size).toBe(1);
  });
});
