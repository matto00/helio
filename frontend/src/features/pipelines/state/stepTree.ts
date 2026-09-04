// buildLaneGraph — HEL-912 task 1.1. Generalizes HEL-908's `buildStepTree`
// (trunk + at-most-one-tail) into an n-lane model (design.md Decision 1).
//
// The wire has no nested `children` — only a flat `parentStepId`. This
// selector does the client-side grouping so `PipelineRiverView` can render
// each lane as its own vertical mini-river (`LaneColumn`).
//
// The position-0 chain from the root is the PRIMARY lane, rendered at the
// top level; a node's position >= 1 children each root their OWN lane. A
// lane continues through single-child edges (so a plain linear chain is one
// lane). This is deliberately NOT symmetric across a node's children --
// design.md Decision 1's first draft ("every child roots a lane, none
// privileged") was wrong: it contradicted this change's own
// `pipeline-tails-ui` delta (a tail renders "beneath the parent trunk
// step", presupposing a trunk that keeps going at top level) and the very
// `primaryLaneId` this module returns, which is load-bearing at several
// call sites. Engine contract item 2 SANCTIONS privileging position 0 in
// the UI rather than forbidding it -- the engine itself disclaims "trunk"
// as a structural concept and hands the choice to this ticket. A single
// child with `position === undefined` (a freshly created, not-yet-persisted
// step) still defaults to continuing the lane, matching pre-lanes
// behavior. Sibling order among a node's non-continuation children is
// ascending `position`, array order as tiebreak -- mirroring the engine's
// own tiebreak (P2.1 engine contract item 4/2).

import type { Step } from "../types/step";

export interface Lane {
  /** Stable id for this lane — the id of the lane's first (root) step. */
  id: string;
  /** The step id this lane branches off of. `undefined` only for the
   *  primary lane, which roots at the pipeline's root step. */
  parentStepId: string | undefined;
  /** This lane's own steps, root-to-leaf. */
  steps: Step[];
  /** How many branch points separate this lane from the primary lane. 0 for
   *  the primary lane, 1 for a lane rooted directly off it, etc. */
  depth: number;
}

export interface LaneGraph {
  /** Every lane, in a deterministic (breadth-first, sibling-position-order)
   *  traversal order — see `laneLayout.ts`, which relies on this order to
   *  assign siblings adjacent columns. */
  lanes: Lane[];
  /** Every step's lane id, by step id. */
  laneOfStepId: Record<string, string>;
  /** The lane rooted at the pipeline's root step (`undefined` for an empty
   *  pipeline). */
  primaryLaneId: string | undefined;
}

export function buildLaneGraph(steps: Step[]): LaneGraph {
  if (steps.length === 0) return { lanes: [], laneOfStepId: {}, primaryLaneId: undefined };

  const indexOf = new Map(steps.map((s, i) => [s.id, i] as const));
  const byId = new Map(steps.map((s) => [s.id, s] as const));
  const childrenByParent = new Map<string, Step[]>();
  let root: Step | undefined;
  for (const s of steps) {
    if (s.parentStepId && byId.has(s.parentStepId)) {
      const list = childrenByParent.get(s.parentStepId) ?? [];
      list.push(s);
      childrenByParent.set(s.parentStepId, list);
    } else if (!root) {
      // First parentless (or dangling-parent) step in array order is the
      // root -- a local not-yet-persisted step (`makeStep`) is also
      // parentless, but by the time it exists there is already a real root
      // earlier in the array, so this branch only ever fires once for the
      // genuine root.
      root = s;
    }
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => {
      const pa = a.position ?? Number.POSITIVE_INFINITY;
      const pb = b.position ?? Number.POSITIVE_INFINITY;
      if (pa !== pb) return pa - pb;
      return indexOf.get(a.id)! - indexOf.get(b.id)!;
    });
  }

  const lanes: Lane[] = [];
  const laneOfStepId: Record<string, string> = {};
  const visited = new Set<string>();

  interface QueueItem {
    startStep: Step;
    parentStepId: string | undefined;
    depth: number;
  }
  const queue: QueueItem[] = root ? [{ startStep: root, parentStepId: undefined, depth: 0 }] : [];

  while (queue.length > 0) {
    const { startStep, parentStepId, depth } = queue.shift()!;
    if (visited.has(startStep.id)) continue; // cycle guard on malformed data

    const laneSteps: Step[] = [];
    let current: Step | undefined = startStep;
    while (current && !visited.has(current.id)) {
      laneSteps.push(current);
      visited.add(current.id);
      laneOfStepId[current.id] = startStep.id;
      const kids: Step[] = childrenByParent.get(current.id) ?? [];
      // The continuation is the position-0 child, if one exists; else (for
      // a not-yet-persisted step whose position isn't known yet) the sole
      // child when it's the only one and carries no position at all.
      // Everything else -- every position >= 1 child, and any additional
      // position-0 child beyond the first -- roots its own lane.
      let continuationIndex = kids.findIndex((k) => k.position === 0);
      if (continuationIndex === -1 && kids.length === 1 && kids[0].position === undefined) {
        continuationIndex = 0;
      }
      for (let i = 0; i < kids.length; i++) {
        if (i === continuationIndex) continue;
        queue.push({ startStep: kids[i], parentStepId: current.id, depth: depth + 1 });
      }
      current = continuationIndex === -1 ? undefined : kids[continuationIndex];
    }
    lanes.push({ id: startStep.id, parentStepId, steps: laneSteps, depth });
  }

  // Totality (task 1.2): anything the walk above never reached (a local
  // in-flight temp step with no `parentStepId` yet beyond the first, or
  // truly orphaned/cyclic data) is appended to the PRIMARY lane, in array
  // order, rather than silently dropped -- the same "append any further
  // parentless step to the trunk" fallback `buildStepTree` used, so
  // malformed/legacy data (any step missing a `parentStepId` link) renders
  // exactly as before rather than splintering into one singleton lane per
  // orphan. A well-formed pipeline (every non-root step's `parentStepId`
  // set) never reaches this branch at all.
  const primaryLane = lanes.find((l) => l.id === root?.id);
  for (const s of steps) {
    if (!visited.has(s.id)) {
      if (primaryLane) {
        primaryLane.steps.push(s);
      } else {
        lanes.push({ id: s.id, parentStepId: s.parentStepId ?? undefined, steps: [s], depth: 0 });
      }
      laneOfStepId[s.id] = primaryLane?.id ?? s.id;
      visited.add(s.id);
    }
  }

  return { lanes, laneOfStepId, primaryLaneId: root?.id };
}

/** Every lane rooted directly off `stepId` (its immediate child-lanes),
 *  in the same sibling order `buildLaneGraph` assigned them. */
export function childLanesOf(graph: LaneGraph, stepId: string): Lane[] {
  return graph.lanes.filter((l) => l.parentStepId === stepId);
}

/** HEL-912 — reorders ONE lane's own steps (`fromIndex`/`toIndex` are
 *  indices into `lane.steps`) and re-flattens the WHOLE graph back into a
 *  full `Step[]` in `executionOrder` shape, generalizing HEL-908's
 *  `reorderTrunk` from "the trunk" to "one lane, any lane."
 *
 *  Relinks the reordered lane's own `parentStepId` chain (its first step
 *  points at the lane's `parentStepId`, each subsequent step points at the
 *  previous step's id) so optimistic local state renders correctly before
 *  the `PUT /steps/order` round trip reconciles it -- the client-side
 *  mirror of `PipelineStepRepository.reorderTrunkInternal`, scoped to one
 *  lane. Reordering one lane must not change any other lane's steps or
 *  their relative position in the flattened output. */
export function reorderLane(
  graph: LaneGraph,
  laneId: string,
  fromIndex: number,
  toIndex: number,
): Step[] {
  const laneIndex = graph.lanes.findIndex((l) => l.id === laneId);
  if (laneIndex === -1) return flattenLaneGraph(graph);

  const lane = graph.lanes[laneIndex];
  const nextSteps = [...lane.steps];
  const [moved] = nextSteps.splice(fromIndex, 1);
  nextSteps.splice(toIndex, 0, moved);
  const relinked = nextSteps.map((step, i) => ({
    ...step,
    parentStepId: i === 0 ? lane.parentStepId : nextSteps[i - 1].id,
  }));

  // A lane's own id is its root step's id, which callers never move to a
  // different index (drag-drop / Move up-down within a lane never touches
  // the lane's own root position), so the lane's id — and every
  // child-lane's `parentStepId` pointing at it — stays stable across the
  // reorder.
  const nextLanes = graph.lanes.map((l, i) => (i === laneIndex ? { ...l, steps: relinked } : l));

  return flattenLaneGraph({ ...graph, lanes: nextLanes });
}

/** Flattens a `LaneGraph` back into a single `Step[]` in the wire's
 *  `executionOrder` convention: for each step (walking the primary lane,
 *  then recursively any lane), every child-lane rooted at that step is
 *  emitted (fully expanded) immediately BEFORE the step itself -- the same
 *  "tail(s) before their own attachment point" convention `buildStepTree`'s
 *  reorderTrunk relied on (see its historical doc comment), generalized
 *  from "the one tail" to "every child-lane." */
export function flattenLaneGraph(graph: LaneGraph): Step[] {
  if (graph.lanes.length === 0) return [];

  const childLanesByParentStep = new Map<string, Lane[]>();
  for (const lane of graph.lanes) {
    if (lane.parentStepId === undefined) continue;
    const list = childLanesByParentStep.get(lane.parentStepId) ?? [];
    list.push(lane);
    childLanesByParentStep.set(lane.parentStepId, list);
  }

  const emitted = new Set<string>();
  function emitLane(lane: Lane): Step[] {
    if (emitted.has(lane.id)) return [];
    emitted.add(lane.id);
    const out: Step[] = [];
    for (const step of lane.steps) {
      const childLanes = childLanesByParentStep.get(step.id) ?? [];
      for (const childLane of childLanes) out.push(...emitLane(childLane));
      out.push(step);
    }
    return out;
  }

  const primaryLane = graph.lanes.find((l) => l.parentStepId === undefined);
  const result: Step[] = [];
  if (primaryLane) result.push(...emitLane(primaryLane));
  // Any lane not reached from the primary lane (orphans, or a second
  // parentless root defensively handled by the totality sweep above) is
  // appended in graph order rather than dropped.
  for (const lane of graph.lanes) {
    if (!emitted.has(lane.id)) result.push(...emitLane(lane));
  }
  return result;
}
