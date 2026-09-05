// buildLaneGraph — HEL-912 task 1.1, generalized to multiple roots by
// HEL-968 (design.md Decision 1). Folds the wire's flat `parentStepId` list
// into lanes so `PipelineRiverView` can render each lane as its own
// vertical mini-river (`LaneColumn`).
//
// The position-0 chain from a root-level step is that root's PRIMARY lane,
// rendered at the top level; a node's position >= 1 children each root
// their OWN lane. A lane continues through single-child edges (so a plain
// linear chain is one lane). This is deliberately NOT symmetric across a
// node's children -- HEL-912 design.md Decision 1's first draft ("every
// child roots a lane, none privileged") was wrong: it contradicted the
// `pipeline-tails-ui` delta (a tail renders "beneath the parent trunk
// step", presupposing a trunk that keeps going at top level). Engine
// contract item 2 SANCTIONS privileging position 0 in the UI rather than
// forbidding it. A single child with `position === undefined` (a freshly
// created, not-yet-persisted step) still defaults to continuing the lane,
// matching pre-lanes behavior. Sibling order among a node's
// non-continuation children is ascending `position`, array order as
// tiebreak -- mirroring the engine's own tiebreak (P2.1 engine contract
// item 4/2).
//
// HEL-968 D1 — `roots` is now an explicit, required parameter: lanes are
// seeded one per root (in `roots` array order, which the wire already
// delivers in `position` order -- see design.md's "Ground truth"), from
// that root's own root-level steps (`step.rootId === root.id`), REPLACING
// the old "first parentless step in the array is the root" heuristic
// entirely. That heuristic structurally could not represent a second root:
// every subsequent parentless step matched neither the childrenByParent nor
// the "first root" branch, so its whole lane was silently dropped. Passing
// the authoritative root set also means a root with zero steps still gets a
// lane (an empty one), which no derivation from `steps` alone could ever
// see. `LaneGraph.primaryLaneId` -- a single-root concept -- is REMOVED,
// not retained alongside: every lane already knows its own `rootId`, and
// keeping a field whose name asserts one privileged lane is exactly R3's
// "no root is primary" prohibition.

import type { Step } from "../types/step";

/** The minimal shape `buildLaneGraph` needs from a root -- just enough to
 *  seed one lane per root, in the caller-supplied order. Real pipelines
 *  pass `PipelineRoot[]`; the proposal-review surface (`proposalLaneGraph.ts`)
 *  passes a synthetic list built from `PipelineProposalSource[]`, since a
 *  proposal's roots have no persisted id yet. */
export interface LaneGraphRoot {
  id: string;
}

export interface Lane {
  /** Stable id for this lane — the id of the lane's first (root) step, or
   *  a synthesized id for an empty root's placeholder lane (task 3.3). */
  id: string;
  /** The step id this lane branches off of. `undefined` for a lane that
   *  originates directly at a root (formerly "the primary lane" -- now true
   *  of every root's own lane, not just one). */
  parentStepId: string | undefined;
  /** This lane's own steps, root-to-leaf. Empty for a root with no steps
   *  yet (task 3.3) -- the lane is still present, not omitted. */
  steps: Step[];
  /** How many branch points separate this lane from its own root's lane. 0
   *  for a root-level lane, 1 for a lane rooted directly off one of its
   *  steps, etc. */
  depth: number;
  /** HEL-968 D1 — the id of the `PipelineRoot`/synthetic root this lane
   *  ultimately originates from. Every lane has one; a lane many branch
   *  points deep still carries the ORIGINATING root's id, not its
   *  immediate parent lane's. */
  rootId: string;
}

export interface LaneGraph {
  /** Every lane, in a deterministic traversal order: root lanes first (in
   *  `roots` order), each followed by its own breadth-first,
   *  sibling-position-order descendants -- see `laneLayout.ts`, which
   *  relies on this order (D2) to assign root columns contiguous indices
   *  and siblings adjacent columns within them. */
  lanes: Lane[];
  /** Every step's lane id, by step id. */
  laneOfStepId: Record<string, string>;
}

function sortSiblings(list: Step[], indexOf: Map<string, number>): void {
  list.sort((a, b) => {
    const pa = a.position ?? Number.POSITIVE_INFINITY;
    const pb = b.position ?? Number.POSITIVE_INFINITY;
    if (pa !== pb) return pa - pb;
    return indexOf.get(a.id)! - indexOf.get(b.id)!;
  });
}

export function buildLaneGraph(steps: Step[], roots: LaneGraphRoot[]): LaneGraph {
  if (steps.length === 0) return { lanes: [], laneOfStepId: {} };

  const indexOf = new Map(steps.map((s, i) => [s.id, i] as const));
  const byId = new Map(steps.map((s) => [s.id, s] as const));
  const childrenByParent = new Map<string, Step[]>();
  const rootStepsByRootId = new Map<string, Step[]>();
  const knownRootIds = new Set(roots.map((r) => r.id));
  // A root-level step (no resolvable parent) whose `rootId` is missing or
  // doesn't match any known root -- malformed/legacy data, or a freshly
  // created local step whose root isn't known yet. Handled by the totality
  // fallback below rather than silently dropped.
  const unassignedRootLevel: Step[] = [];

  for (const s of steps) {
    if (s.parentStepId && byId.has(s.parentStepId)) {
      const list = childrenByParent.get(s.parentStepId) ?? [];
      list.push(s);
      childrenByParent.set(s.parentStepId, list);
    } else if (s.rootId && knownRootIds.has(s.rootId)) {
      const list = rootStepsByRootId.get(s.rootId) ?? [];
      list.push(s);
      rootStepsByRootId.set(s.rootId, list);
    } else {
      unassignedRootLevel.push(s);
    }
  }
  for (const list of childrenByParent.values()) sortSiblings(list, indexOf);
  for (const list of rootStepsByRootId.values()) sortSiblings(list, indexOf);

  const lanes: Lane[] = [];
  const laneOfStepId: Record<string, string> = {};
  const visited = new Set<string>();

  interface QueueItem {
    startStep: Step;
    parentStepId: string | undefined;
    depth: number;
    rootId: string;
  }
  const queue: QueueItem[] = [];
  for (const root of roots) {
    const rootSteps = rootStepsByRootId.get(root.id) ?? [];
    for (const s of rootSteps) {
      queue.push({ startStep: s, parentStepId: undefined, depth: 0, rootId: root.id });
    }
  }
  // Fallback root for unassigned root-level steps. Mirrors the pre-multi-root
  // "first parentless (or dangling-parent) step in array order is the root"
  // rule, but ONLY when no real root has already seeded a lane (every step
  // is legacy/local data with no resolvable `rootId` at all) -- otherwise a
  // second, unassigned parentless step (e.g. a local in-flight temp step
  // created before its `rootId` is known -- `makeStep()` carries neither
  // `parentStepId` nor `rootId` until the create call resolves) would seed
  // its OWN lane instead of falling in behind the step(s) a real root
  // already claimed. In that "no real root seeded anything yet" case, only
  // the FIRST unassigned step seeds a lane; every subsequent one falls
  // through to the totality sweep below and is appended to it instead,
  // exactly like `buildStepTree` used to.
  const fallbackRootId = roots[0]?.id;
  const firstUnassigned = unassignedRootLevel[0];
  if (firstUnassigned && rootStepsByRootId.size === 0) {
    queue.push({
      startStep: firstUnassigned,
      parentStepId: undefined,
      depth: 0,
      rootId: fallbackRootId ?? firstUnassigned.id,
    });
  }

  while (queue.length > 0) {
    const { startStep, parentStepId, depth, rootId } = queue.shift()!;
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
        queue.push({ startStep: kids[i], parentStepId: current.id, depth: depth + 1, rootId });
      }
      current = continuationIndex === -1 ? undefined : kids[continuationIndex];
    }
    lanes.push({ id: startStep.id, parentStepId, steps: laneSteps, depth, rootId });
  }

  // Task 3.3 — a root with zero root-level steps still gets an entry in
  // `lanes` (an empty lane), rather than vanishing: the UI renders it with
  // an empty-lane affordance instead of the column disappearing.
  for (const root of roots) {
    const hasRootLane = lanes.some((l) => l.rootId === root.id && l.parentStepId === undefined);
    if (!hasRootLane) {
      lanes.push({
        id: `empty-root:${root.id}`,
        parentStepId: undefined,
        steps: [],
        depth: 0,
        rootId: root.id,
      });
    }
  }

  // Totality (carried over from the single-root implementation): anything
  // the walk above never reached (a local in-flight temp step with no
  // `parentStepId` yet, or truly orphaned/cyclic data) is appended to the
  // first non-empty lane, in array order, rather than silently dropped.
  const firstNonEmptyLane = lanes.find((l) => l.steps.length > 0);
  for (const s of steps) {
    if (!visited.has(s.id)) {
      if (firstNonEmptyLane) {
        firstNonEmptyLane.steps.push(s);
        laneOfStepId[s.id] = firstNonEmptyLane.id;
      } else {
        lanes.push({
          id: s.id,
          parentStepId: s.parentStepId ?? undefined,
          steps: [s],
          depth: 0,
          rootId: s.rootId ?? fallbackRootId ?? s.id,
        });
        laneOfStepId[s.id] = s.id;
      }
      visited.add(s.id);
    }
  }

  return { lanes, laneOfStepId };
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
 *  `executionOrder` convention: for each root's own lane (in `graph.lanes`'
 *  order, which follows `roots` order), then recursively any lane, every
 *  child-lane rooted at a step is emitted (fully expanded) immediately
 *  BEFORE the step itself -- the same "tail(s) before their own attachment
 *  point" convention `buildStepTree`'s `reorderTrunk` relied on, generalized
 *  first from "the one tail" to "every child-lane" (HEL-912), then from "the
 *  one root lane" to "every root's own lane" (HEL-968). */
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

  // Root-level lanes (one per root, `parentStepId === undefined`) already
  // appear in `graph.lanes` in root order, since `buildLaneGraph` seeds the
  // queue root-by-root in that order.
  const rootLanes = graph.lanes.filter((l) => l.parentStepId === undefined);
  const result: Step[] = [];
  for (const rootLane of rootLanes) result.push(...emitLane(rootLane));
  // Any lane not reached from a root lane (orphans defensively handled by
  // the totality sweep above) is appended in graph order rather than
  // dropped.
  for (const lane of graph.lanes) {
    if (!emitted.has(lane.id)) result.push(...emitLane(lane));
  }
  return result;
}
