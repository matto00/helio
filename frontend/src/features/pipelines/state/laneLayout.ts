// computeLaneLayout — HEL-912 task 2. Pure, synchronous column/row
// assignment over a `LaneGraph` (design.md Decision 2). Kept as a plain
// function over data (not a hook) so "deterministic column assignment" is a
// Jest assertion on a return value, not a render-order observation.
//
// Column: a lane's column is its own index within `graph.lanes` — which
// `buildLaneGraph` already produces in breadth-first, sibling-position
// order (each node's children are enqueued together, in ascending
// `position`/array-order tiebreak, right after that node's own lane chain
// ends), so reusing that order gives sibling lanes distinct, ADJACENT
// columns for free, matching the engine's own tiebreak (P2.1 contract
// item 4).
//
// Row: the longest-path-from-root over the UNION of two edge kinds --
// `parentStepId` (the structural DAG edge) and a rejoin step's
// `secondaryInput` (a `{kind:"lane"}` reference is a real second DAG edge,
// P2.1 contract item 2). `row(step) = 1 + max(row(pred) for pred in
// predecessors)`, `row(root) = 0`. This is exactly design Decision 2's "a
// rejoin is placed at max(row of every input) + 1" -- stated globally
// rather than lane-locally, so a rejoin naming a NON-terminal node (P2.1
// contract item 6) or a node consumed by SEVERAL rejoins both fall out of
// the same recursion with no special-casing, and neither is dropped,
// deduplicated, or treated as invalid.

import type { LaneGraph } from "./stepTree";
import type { Step } from "../types/step";
import type { PipelineStepConfig } from "../types/pipelineStep";
import type { SecondaryInput } from "../types/pipelineStep";

export interface LaneSlot {
  lane: number;
  row: number;
}

export interface LaneLayout {
  slotOfStepId: Record<string, LaneSlot>;
  laneCount: number;
  /** Consumed-node step id -> every rejoin step id that consumes it via a
   *  `{kind:"lane"}` secondaryInput. A node consumed by several rejoins
   *  gets an entry with several ids; a rejoin naming a non-terminal node is
   *  still recorded (that node keeps its own primary-chain entry too). */
  rejoinEdges: Record<string, string[]>;
}

// HEL-914 task 6.8: exported so the pipeline-proposal review UI can show a rejoin's second
// input without a second implementation of this same shape-check.
export function secondaryInputOf(config: PipelineStepConfig): SecondaryInput | undefined {
  if (
    typeof config === "object" &&
    config !== null &&
    "secondaryInput" in config &&
    config.secondaryInput &&
    typeof config.secondaryInput === "object" &&
    "kind" in config.secondaryInput
  ) {
    return config.secondaryInput as SecondaryInput;
  }
  return undefined;
}

export function computeLaneLayout(graph: LaneGraph): LaneLayout {
  const columnOfLaneId = new Map(graph.lanes.map((lane, i) => [lane.id, i] as const));
  const byId = new Map<string, Step>();
  for (const lane of graph.lanes) for (const step of lane.steps) byId.set(step.id, step);

  const rejoinEdges: Record<string, string[]> = {};
  const rowMemo = new Map<string, number>();
  const inProgress = new Set<string>();

  function predecessorsOf(step: Step): string[] {
    const preds: string[] = [];
    if (step.parentStepId && byId.has(step.parentStepId)) preds.push(step.parentStepId);
    const secondary = secondaryInputOf(step.config);
    if (secondary?.kind === "lane" && byId.has(secondary.stepId)) {
      preds.push(secondary.stepId);
      const consumers = rejoinEdges[secondary.stepId] ?? [];
      if (!consumers.includes(step.id)) rejoinEdges[secondary.stepId] = [...consumers, step.id];
    }
    return preds;
  }

  function rowOf(stepId: string): number {
    const memoized = rowMemo.get(stepId);
    if (memoized !== undefined) return memoized;
    const step = byId.get(stepId);
    if (!step) return 0;
    if (inProgress.has(stepId)) return 0; // cycle guard on malformed data
    inProgress.add(stepId);
    const preds = predecessorsOf(step);
    const row = preds.length === 0 ? 0 : 1 + Math.max(...preds.map(rowOf));
    inProgress.delete(stepId);
    rowMemo.set(stepId, row);
    return row;
  }

  const slotOfStepId: Record<string, LaneSlot> = {};
  for (const lane of graph.lanes) {
    const laneColumn = columnOfLaneId.get(lane.id) ?? 0;
    for (const step of lane.steps) {
      slotOfStepId[step.id] = { lane: laneColumn, row: rowOf(step.id) };
    }
  }

  return { slotOfStepId, laneCount: graph.lanes.length, rejoinEdges };
}

/** HEL-912 task 6.1 — builds the "off <step>" Outputs-gallery subtitle from
 *  the lane graph (not a second traversal): a primary-lane step's subtitle
 *  is unchanged (just its label); a non-primary-lane step's subtitle gains
 *  a `›`-separated lane segment naming which lane off its branch point it
 *  is, e.g. `filter › lane 2 › aggregate`. Ids substituted for display
 *  labels at render time, matching P2.1 contract item 11's convention. */
export function laneOutputSubtitle(
  graph: LaneGraph,
  stepLabelById: Map<string, string>,
  stepId: string,
): string {
  const fallback = "an unknown step";
  const laneId = graph.laneOfStepId[stepId];
  const lane = graph.lanes.find((l) => l.id === laneId);
  const stepLabel = stepLabelById.get(stepId) ?? fallback;
  if (!lane || lane.id === graph.primaryLaneId || lane.parentStepId === undefined) {
    return stepLabel;
  }
  const branchStepLabel = stepLabelById.get(lane.parentStepId) ?? fallback;
  const siblingLanes = graph.lanes.filter((l) => l.parentStepId === lane.parentStepId);
  const laneNumber = siblingLanes.findIndex((l) => l.id === lane.id) + 1;
  return `${branchStepLabel} › lane ${laneNumber} › ${stepLabel}`;
}

/** HEL-912 task 5.4 — every step this `stepId` transitively depends on
 *  (via `parentStepId` AND any existing `{kind:"lane"}` secondaryInput
 *  edge, since a lane edge is a real DAG edge, P2.1 contract item 2).
 *  Selecting one of these as `stepId`'s own secondary input would close a
 *  cycle. */
export function computeAncestorIds(steps: Step[], stepId: string): Set<string> {
  const byId = new Map(steps.map((s) => [s.id, s] as const));
  const ancestors = new Set<string>();
  const stack = [stepId];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const step = byId.get(id);
    if (!step) continue;
    const preds: string[] = [];
    if (step.parentStepId && byId.has(step.parentStepId)) preds.push(step.parentStepId);
    const secondary = secondaryInputOf(step.config);
    if (secondary?.kind === "lane" && byId.has(secondary.stepId)) preds.push(secondary.stepId);
    for (const pred of preds) {
      if (pred !== stepId) ancestors.add(pred);
      stack.push(pred);
    }
  }
  return ancestors;
}
