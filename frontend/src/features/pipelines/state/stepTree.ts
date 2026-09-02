// buildStepTree — HEL-908 task 3.4. Groups a pipeline's flat `Step[]`
// (as fetched from `GET /api/pipelines/:id/steps`, which returns the
// backend's `executionOrder` — trunk/tail structural order, NOT a global
// position sort; see `PipelineStepRepository.executionOrder`) into a trunk
// chain plus zero-or-one tail chain per trunk node (design.md decision 1).
//
// The wire has no nested `children` — only a flat `parentStepId`. This
// selector does the client-side grouping so `PipelineRiverView` can render
// the trunk as its own list and each `StepCard` can render its own
// `TailChain` (if any) nested/indented beneath it.
//
// Deriving trunk-vs-tail from array order + `position`: among a node's
// children (grouped by `parentStepId`), `executionOrder` always emits a
// node's tail branches (each fully expanded) BEFORE its trunk continuation
// — see the backend doc comment. So for a node with two children, whichever
// child appears EARLIER in the flat array is the tail root, and whichever
// appears LATER is the trunk continuation (the Phase-1 invariant this
// ticket's editor enforces: "single tail per node" — a node can have at
// most a trunk child and at most ONE tail root, never two-plus tails).
//
// A node with only ONE child is where evaluation-1 cycle-2 CR1 found a real
// bug: array order alone can't disambiguate it (there's no second child to
// order against), so this used to assume "always trunk continuation" --
// which was correct only for a genuine trunk-continuation insert, and WRONG
// for a tail attached onto a previously-childless (leaf) anchor, the common
// case of adding a tail off the pipeline's current last trunk step. Fixed
// by consulting the child's own `position` (now carried on the UI `Step`
// type, mirroring the wire's `PipelineStep.position`): a single child at
// `position === 0` is the trunk continuation; a single child at
// `position >= 1` is a tail root, and the anchor's own `position === 0`
// slot is left empty (not back-filled) rather than treated as occupied.
// `position === undefined` (a freshly created, not-yet-persisted local temp
// step) still defaults to trunk continuation, matching the pre-fix
// behavior for that case -- there is no tail-attach affordance for a
// not-yet-persisted anchor to race against.

import type { Step } from "../types/step";

export interface StepTree {
  /** The pipeline's trunk, root-to-leaf, in the order `PipelineRiverView`
   *  should render its main step list. */
  trunk: Step[];
  /** This trunk step's tail chain (root-to-leaf), keyed by trunk step id.
   *  Absent (no key) for a trunk step with no tail. At most one entry's
   *  worth of steps per key — the single-tail-per-node invariant. */
  tailsByStepId: Record<string, Step[]>;
}

/** Walks a chain with no further branching (the tail invariant: every node
 *  inside an existing tail has at most one child of its own) starting at
 *  `start`, marking each visited id in `visited` as it goes. */
function walkChain(
  start: Step,
  childrenByParent: Map<string, Step[]>,
  visited: Set<string>,
): Step[] {
  const chain: Step[] = [];
  let current: Step | undefined = start;
  while (current && !visited.has(current.id)) {
    chain.push(current);
    visited.add(current.id);
    const kids: Step[] = childrenByParent.get(current.id) ?? [];
    current = kids[0];
  }
  return chain;
}

export function buildStepTree(steps: Step[]): StepTree {
  if (steps.length === 0) return { trunk: [], tailsByStepId: {} };

  const indexOf = new Map(steps.map((s, i) => [s.id, i] as const));
  const childrenByParent = new Map<string, Step[]>();
  let root: Step | undefined;
  for (const s of steps) {
    if (s.parentStepId) {
      const list = childrenByParent.get(s.parentStepId) ?? [];
      list.push(s);
      childrenByParent.set(s.parentStepId, list);
    } else if (!root) {
      // First parentless step in array order is the root. A local
      // not-yet-persisted step (`makeStep` with no `parentStepId`, mid
      // `handleAddStep`/`handleInsertStep`) is also parentless, but by the
      // time it exists there is already a real root earlier in the array,
      // so this branch only ever fires once, for the genuine root.
      root = s;
    }
  }
  // Earlier array index first — the tail-before-trunk-continuation
  // ordering `executionOrder` guarantees (see file doc comment above).
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => indexOf.get(a.id)! - indexOf.get(b.id)!);
  }

  const trunk: Step[] = [];
  const tailsByStepId: Record<string, Step[]> = {};
  const visited = new Set<string>();

  let current: Step | undefined = root;
  while (current && !visited.has(current.id)) {
    trunk.push(current);
    visited.add(current.id);
    const kids = childrenByParent.get(current.id) ?? [];
    if (kids.length > 1) {
      // Per the single-tail invariant there should be exactly 2: one tail
      // root (earlier) and one trunk continuation (later). If the editor's
      // enforcement is ever bypassed (e.g. stale data), only the first
      // (earliest) extra child is treated as the tail; any further children
      // are picked up by the orphan sweep below rather than silently lost.
      tailsByStepId[current.id] = walkChain(kids[0], childrenByParent, visited);
      current = kids[kids.length - 1];
    } else if (kids.length === 1 && kids[0].position !== undefined && kids[0].position !== 0) {
      // CR1: a single child at a non-zero position is a tail attached onto
      // a previously-childless anchor, NOT a trunk continuation -- the
      // anchor's own trunk ends here, and its position-0 slot stays empty.
      tailsByStepId[current.id] = walkChain(kids[0], childrenByParent, visited);
      current = undefined;
    } else {
      current = kids[0];
    }
  }

  // Anything not reached by the walk above (a local in-flight temp step
  // with no `parentStepId` yet, or truly orphaned data) is appended to the
  // trunk in its original array position rather than silently dropped.
  for (const s of steps) {
    if (!visited.has(s.id)) {
      trunk.push(s);
      visited.add(s.id);
    }
  }

  return { trunk, tailsByStepId };
}

/** True when `stepId` already has a tail — used to disable/hide the
 *  "+ tail" affordance per node (task 3.4's single-tail-per-node
 *  enforcement). */
export function hasTail(tree: StepTree, stepId: string): boolean {
  return (tree.tailsByStepId[stepId]?.length ?? 0) > 0;
}

/** HEL-908 — reorders the TRUNK only (`fromIndex`/`toIndex` are indices into
 *  `tree.trunk`, i.e. what `PipelineRiverView`'s drag-drop / Move up-down
 *  handlers actually operate on) and re-flattens back into a full `Step[]`
 *  in `executionOrder` shape (each trunk node's own tail chain, if any,
 *  emitted immediately BEFORE that node — the same tail-before-trunk-
 *  continuation convention `buildStepTree` above relies on to re-derive
 *  trunk-vs-tail from array order alone).
 *
 *  `buildStepTree` derives topology from each step's `parentStepId`, not
 *  from array position (array order only disambiguates which of a node's
 *  EXISTING children is tail-vs-trunk) — so a pure array-position reorder
 *  with `parentStepId` left untouched would be a no-op for the resulting
 *  tree, exactly the bug this ticket exists to fix. This function therefore
 *  ALSO relinks each trunk node's own `parentStepId` to match the new
 *  order (`orderedTrunk[0].parentStepId = undefined`, each subsequent
 *  node's `parentStepId = orderedTrunk[i - 1].id`) — a client-side mirror
 *  of exactly what `PipelineStepRepository.reorderTrunkInternal` does
 *  server-side (design.md decision 15), so the OPTIMISTIC local state
 *  (before the `PUT /steps/order` response reconciles it) already renders
 *  correctly instead of waiting on the round trip.
 *
 *  Per the human's ruling ("the tail follows its trunk step"): each trunk
 *  node's tail entry is read from `tree.tailsByStepId` by that node's OWN
 *  id and returned WITH NO CHANGES to the tail steps themselves (their own
 *  `parentStepId` already points at their trunk node's id, which never
 *  changes here) — so a moved node's tail is automatically carried to the
 *  node's new position, and the node now occupying its old slot does not
 *  inherit it.
 *
 *  This replaces raw `moveStep(flatSteps, ...)` at every trunk-reorder call
 *  site (drag-drop, Move up/down): those used to index directly into the
 *  FULL flat array using TRUNK-relative indices, which silently mismatched
 *  the instant any pipeline had a tail (the flat array interleaves tails
 *  before their trunk node, so a trunk index no longer equals a flat-array
 *  index) — found and fixed in the same pass as design.md decision 15's
 *  trunk-only `PUT /steps/order` contract. */
export function reorderTrunk(tree: StepTree, fromIndex: number, toIndex: number): Step[] {
  const nextTrunk = [...tree.trunk];
  const [moved] = nextTrunk.splice(fromIndex, 1);
  nextTrunk.splice(toIndex, 0, moved);
  const relinked = nextTrunk.map((step, i) => ({
    ...step,
    parentStepId: i === 0 ? undefined : nextTrunk[i - 1].id,
  }));
  return relinked.flatMap((step) => [...(tree.tailsByStepId[step.id] ?? []), step]);
}
