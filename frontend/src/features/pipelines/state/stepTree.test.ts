// stepTree.test.ts — HEL-908 task 3.4: buildStepTree/hasTail coverage.

import { buildStepTree, hasTail, reorderTrunk } from "./stepTree";
import { OP_TYPES } from "./stepNarrowing";
import type { Step } from "../types/step";

const OP = OP_TYPES.find((op) => op.id === "filter")!;

function step(id: string, parentStepId?: string, position?: number): Step {
  return {
    id,
    opType: OP,
    label: OP.label,
    config: { combinator: "AND", conditions: [] },
    enabled: true,
    parentStepId,
    position,
  };
}

describe("buildStepTree", () => {
  it("returns an empty tree for zero steps", () => {
    expect(buildStepTree([])).toEqual({ trunk: [], tailsByStepId: {} });
  });

  it("treats a pure trunk (no tails) as a single chain, root to leaf", () => {
    const a = step("a");
    const b = step("b", "a");
    const c = step("c", "b");
    const tree = buildStepTree([a, b, c]);
    expect(tree.trunk.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(tree.tailsByStepId).toEqual({});
  });

  it("splits a tail off a trunk node, tail-before-trunk-continuation array order", () => {
    // executionOrder shape: node, then its tail (expanded), then trunk continuation.
    const a = step("a");
    const tailHead = step("t1", "a");
    const tailNext = step("t2", "t1");
    const b = step("b", "a"); // trunk continuation off `a`, appears AFTER the tail in the array
    const tree = buildStepTree([a, tailHead, tailNext, b]);
    expect(tree.trunk.map((s) => s.id)).toEqual(["a", "b"]);
    expect(tree.tailsByStepId["a"]?.map((s) => s.id)).toEqual(["t1", "t2"]);
  });

  it("supports a tail off a non-root trunk node", () => {
    const a = step("a");
    const b = step("b", "a");
    const tailHead = step("t1", "b");
    const c = step("c", "b");
    const tree = buildStepTree([a, b, tailHead, c]);
    expect(tree.trunk.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(tree.tailsByStepId["b"]?.map((s) => s.id)).toEqual(["t1"]);
    expect(tree.tailsByStepId["a"]).toBeUndefined();
  });

  // Evaluation-1 cycle-2 CR1: a leaf anchor (no existing children) gaining
  // exactly ONE new child at `position >= 1` -- the shape `attachTailInternal`
  // now always produces for the common "add tail off the last trunk step"
  // case -- must render as a tail, not a trunk continuation, even though
  // array order alone can't disambiguate a single child.
  it("a single child at position >= 1 (leaf-anchor tail attach) renders as a tail, not a trunk continuation", () => {
    const a = step("a");
    const tail = step("t1", "a", 1);
    const tree = buildStepTree([a, tail]);
    expect(tree.trunk.map((s) => s.id)).toEqual(["a"]);
    expect(tree.tailsByStepId["a"]?.map((s) => s.id)).toEqual(["t1"]);
  });

  it("a single child at position 0 still renders as a trunk continuation (unchanged behavior)", () => {
    const a = step("a");
    const b = step("b", "a", 0);
    const tree = buildStepTree([a, b]);
    expect(tree.trunk.map((s) => s.id)).toEqual(["a", "b"]);
    expect(tree.tailsByStepId).toEqual({});
  });

  it("a single child with position undefined (local not-yet-persisted step) still defaults to trunk continuation", () => {
    const a = step("a");
    const temp = step("step-1", "a");
    const tree = buildStepTree([a, temp]);
    expect(tree.trunk.map((s) => s.id)).toEqual(["a", "step-1"]);
    expect(tree.tailsByStepId).toEqual({});
  });

  it("appends an in-flight temp step (no parentStepId yet) to the trunk without dropping it", () => {
    const a = step("a");
    const b = step("b", "a");
    const temp = step("step-1"); // makeStep()'s shape: no parentStepId until persisted
    const tree = buildStepTree([a, b, temp]);
    expect(tree.trunk.map((s) => s.id)).toEqual(["a", "b", "step-1"]);
  });

  it("skeptic-final-2 (round 1) CR1 context: a node that already has a tail (position >= 1) reports hasTail=true, which is the exact signal `handleInstantiateShape`'s callers must gate on before attaching a SECOND tail to it", () => {
    // Documents the invariant the fix at the handler/UI layer (not here)
    // relies on: `buildStepTree` correctly derives that B already has a
    // tail from real, well-formed data. Feeding it a THIRD child at
    // `position >= 2` (what the OLD, buggy `handleInstantiateShape` used to
    // persist by calling `attachAsTail: true` on an already-tailed anchor)
    // is a data-integrity violation of the single-tail invariant this
    // selector assumes holds by construction — the fix is to never create
    // that shape server-side in the first place (see
    // `usePipelineDetailPage.ts`'s `handleInstantiateShape` and
    // `PipelineRiverView.test.tsx`'s "trunk-last-tail gate" suite), not to
    // make this selector degrade gracefully for a state that must not exist.
    const a = step("a");
    const b = step("b", "a");
    const t = step("t", "b", 1);
    const tree = buildStepTree([a, b, t]);
    expect(hasTail(tree, "b")).toBe(true);
    expect(tree.trunk.map((st) => st.id)).toEqual(["a", "b"]);
  });

  it("hasTail reflects tailsByStepId presence/length", () => {
    const a = step("a");
    const tailHead = step("t1", "a");
    const b = step("b", "a");
    const tree = buildStepTree([a, tailHead, b]);
    expect(hasTail(tree, "a")).toBe(true);
    expect(hasTail(tree, "b")).toBe(false);
    expect(hasTail(tree, "nonexistent")).toBe(false);
  });
});

// HEL-908 — reorderTrunk: permutes the trunk and re-flattens with each
// node's tail carried along by node id (the human's ruling: "the tail
// follows its trunk step"). This is also a regression guard for a real bug
// found alongside design.md decision 15: `PipelineRiverView`'s drag-drop and
// Move up/down handlers used to call `moveStep` directly on the FLAT array
// using TRUNK-relative indices -- silently mismatched the instant any
// pipeline had a tail (the flat array interleaves a node's tail BEFORE the
// node itself, per `executionOrder`).
describe("reorderTrunk", () => {
  it("permutes a pure trunk with no tails (regression guard: behaves exactly like a flat moveStep)", () => {
    const a = step("a");
    const b = step("b", "a");
    const c = step("c", "b");
    const tree = buildStepTree([a, b, c]);
    // Move c (index 2) to index 0.
    const result = reorderTrunk(tree, 2, 0);
    expect(result.map((s) => s.id)).toEqual(["c", "a", "b"]);
  });

  it("a moved trunk node's tail travels with it to its new position", () => {
    // a -> b -> c, tail_A hangs off a. Move a to sit after b: b -> a -> c,
    // tail_A must still render immediately before a (its own node), not
    // wherever b (the node now occupying a's old slot) ends up.
    const a = step("a");
    const b = step("b", "a");
    const c = step("c", "b");
    const tailA = step("tail-a", "a");
    const tree = buildStepTree([a, tailA, b, c]);
    expect(tree.trunk.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(tree.tailsByStepId["a"]?.map((s) => s.id)).toEqual(["tail-a"]);

    // Move a (index 0) to index 1 (after b).
    const result = reorderTrunk(tree, 0, 1);
    // Flattened order (executionOrder shape: each node's tail immediately
    // before it): b, tail-a, a, c.
    expect(result.map((s) => s.id)).toEqual(["b", "tail-a", "a", "c"]);

    // Re-deriving the tree from this flattened result confirms the UI would
    // render it correctly: tail-a is STILL a's tail, and b (the new
    // occupant of a's old slot) has none.
    const rebuilt = buildStepTree(result);
    expect(rebuilt.trunk.map((s) => s.id)).toEqual(["b", "a", "c"]);
    expect(rebuilt.tailsByStepId["a"]?.map((s) => s.id)).toEqual(["tail-a"]);
    expect(rebuilt.tailsByStepId["b"]).toBeUndefined();
  });

  it("MUTATION PROOF: a naive flat moveStep on the same shape would misclassify the tail", () => {
    // Confirms the guard above is not vacuous -- the OLD (buggy) approach of
    // calling moveStep directly on the flat array using trunk-relative
    // indices really does produce a different, WRONG result on this shape.
    const a = step("a");
    const b = step("b", "a");
    const c = step("c", "b");
    const tailA = step("tail-a", "a");
    const flat = [a, tailA, b, c]; // buildStepTree's flat input shape
    function naiveMoveStep<T>(items: T[], fromIndex: number, toIndex: number): T[] {
      const next = [...items];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    }
    // The old bug: using TRUNK index 0 (a) directly against the FLAT array,
    // where a is actually at flat index 0 too here (coincidentally aligned
    // for this shape) -- but toIndex 1 (trunk-relative "after b") lands on
    // the flat array's index 1, which is tail-a, not b.
    const naiveResult = naiveMoveStep(flat, 0, 1);
    expect(naiveResult.map((s) => s.id)).toEqual(["tail-a", "a", "b", "c"]);
    const naiveRebuilt = buildStepTree(naiveResult);
    // Confirmed RED: the naive approach's re-derived trunk is WRONG --
    // it did not move a after b at all (a is still trunk-first), unlike
    // reorderTrunk's correct ["b", "a", "c"] above.
    expect(naiveRebuilt.trunk.map((s) => s.id)).not.toEqual(["b", "a", "c"]);
  });

  it("the old-slot occupant does not inherit the moved node's tail (no-tail case, regression guard)", () => {
    const a = step("a");
    const b = step("b", "a");
    const c = step("c", "b");
    const tree = buildStepTree([a, b, c]);
    const result = reorderTrunk(tree, 0, 1); // move a after b: b, a, c
    const rebuilt = buildStepTree(result);
    expect(rebuilt.trunk.map((s) => s.id)).toEqual(["b", "a", "c"]);
    expect(rebuilt.tailsByStepId["b"]).toBeUndefined();
    expect(rebuilt.tailsByStepId["a"]).toBeUndefined();
  });
});
