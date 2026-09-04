// stepTree.test.ts — HEL-912 task 1.4: buildLaneGraph/reorderLane coverage,
// rewritten from HEL-908's trunk/at-most-one-tail model to the n-lane
// model (design.md Decision 1). Every test below was run against the
// PRE-CHANGE `buildStepTree` grouping and observed to fail — see
// `files-modified.md` for the recorded failure per test (lesson 8: assert
// the produced lane membership/order, not merely that the call returned).

import { buildLaneGraph, childLanesOf, flattenLaneGraph, reorderLane } from "./stepTree";
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

describe("buildLaneGraph", () => {
  it("returns an empty graph for zero steps", () => {
    expect(buildLaneGraph([])).toEqual({ lanes: [], laneOfStepId: {}, primaryLaneId: undefined });
  });

  it("treats a pure chain (no branches) as a single lane, root to leaf", () => {
    const a = step("a");
    const b = step("b", "a");
    const c = step("c", "b");
    const graph = buildLaneGraph([a, b, c]);
    expect(graph.lanes).toHaveLength(1);
    expect(graph.lanes[0].steps.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(graph.primaryLaneId).toBe(graph.lanes[0].id);
  });

  // evaluation-1.md CR6 — retitled from the pre-ruling ("every child of a
  // node roots its own lane... no single one privileged") claim, which is
  // now REPUDIATED (design.md Decision 1, human-ruled `keep-continuation-
  // privileged`): the position-0 child continues the PRIMARY lane; only its
  // position >= 1 siblings each root their own lane. This case gives one of
  // three children an explicit `position: 0` so the ruling is visible in
  // this file's own prose, not just in `stepTree.ts`'s implementation.
  it("a position-0 child continues the primary lane; its position>=1 siblings (t1's own chain, and b) each root their own lane", () => {
    const a = step("a");
    const cont = step("cont", "a", 0); // continuation -- stays in a's own lane
    const t1 = step("t1", "a", 1);
    const t2 = step("t2", "t1");
    const b = step("b", "a", 2);
    const graph = buildLaneGraph([a, t1, t2, b, cont]);
    // Totality (task 1.2): every step lands in exactly one lane.
    const total = graph.lanes.reduce((sum, l) => sum + l.steps.length, 0);
    expect(total).toBe(5);
    const primary = graph.lanes.find((l) => l.id === graph.primaryLaneId)!;
    expect(primary.steps.map((s) => s.id)).toEqual(["a", "cont"]);
    expect(graph.lanes).toHaveLength(3); // primary [a,cont], [t1,t2], [b]
    const tailLane = childLanesOf(graph, "a").find((l) => l.steps[0].id === "t1")!;
    expect(tailLane.steps.map((s) => s.id)).toEqual(["t1", "t2"]);
    const bLane = childLanesOf(graph, "a").find((l) => l.steps[0].id === "b")!;
    expect(bLane.steps.map((s) => s.id)).toEqual(["b"]);
  });

  // evaluation-1.md CR6 — retitled from the pre-ruling "neither privileged as
  // 'the' continuation" claim. What this case actually pins: when NEITHER of
  // a node's children carries an explicit `position` (both `undefined`,
  // e.g. two tails attached to the same anchor before either is reordered),
  // there is no position-0 candidate to continue the lane, so BOTH root
  // their own lane off that node -- a narrower, still-real property, not
  // "no child is ever privileged" (the case above shows one IS, when
  // `position` says so).
  it("supports a lane off a non-root node -- when NEITHER of b's two children carries a position, both root their own lane off b", () => {
    const a = step("a");
    const b = step("b", "a");
    const t1 = step("t1", "b");
    const c = step("c", "b");
    const graph = buildLaneGraph([a, b, t1, c]);
    const primary = graph.lanes.find((l) => l.id === graph.primaryLaneId)!;
    expect(primary.steps.map((s) => s.id)).toEqual(["a", "b"]);
    expect(childLanesOf(graph, "b")).toHaveLength(2);
    expect(childLanesOf(graph, "b").map((l) => l.steps.map((s) => s.id))).toEqual([["t1"], ["c"]]);
    expect(childLanesOf(graph, "a")).toHaveLength(0);
  });

  it("position-0 child continues the primary lane; its position>=1 siblings each root their own lane, in ascending position order", () => {
    const a = step("a");
    const c1 = step("c1", "a", 3);
    const c2 = step("c2", "a", 0); // continuation -- stays in a's own lane
    const c3 = step("c3", "a", 1);
    const c4 = step("c4", "a", 2);
    // Array order deliberately scrambled relative to `position`.
    const graph = buildLaneGraph([a, c1, c2, c3, c4]);
    const primary = graph.lanes.find((l) => l.id === graph.primaryLaneId)!;
    expect(primary.steps.map((s) => s.id)).toEqual(["a", "c2"]);
    const children = childLanesOf(graph, "a");
    expect(children.map((l) => l.steps[0].id)).toEqual(["c3", "c4", "c1"]);
  });

  it("a node with THREE position>=1 children (beyond the old single-tail invariant) roots THREE lanes, none dropped", () => {
    const a = step("a");
    const b = step("b", "a", 1);
    const c = step("c", "a", 2);
    const d = step("d", "a", 3);
    const graph = buildLaneGraph([a, b, c, d]);
    expect(childLanesOf(graph, "a")).toHaveLength(3);
    const total = graph.lanes.reduce((sum, l) => sum + l.steps.length, 0);
    expect(total).toBe(4);
  });

  it("the position-0 continuation renders at the top level (primary lane), matching pipeline-tails-ui's 'trunk continues' presupposition", () => {
    const a = step("a");
    const trunkNext = step("b", "a", 0);
    const tail = step("t", "a", 1);
    const graph = buildLaneGraph([a, trunkNext, tail]);
    const primary = graph.lanes.find((l) => l.id === graph.primaryLaneId)!;
    expect(primary.steps.map((s) => s.id)).toEqual(["a", "b"]);
    expect(childLanesOf(graph, "a")).toHaveLength(1);
    expect(childLanesOf(graph, "a")[0].steps.map((s) => s.id)).toEqual(["t"]);
  });

  it("a single child with position undefined (local not-yet-persisted step) continues the same lane", () => {
    const a = step("a");
    const temp = step("step-1", "a");
    const graph = buildLaneGraph([a, temp]);
    expect(graph.lanes).toHaveLength(1);
    expect(graph.lanes[0].steps.map((s) => s.id)).toEqual(["a", "step-1"]);
  });

  it("appends an in-flight temp step (no parentStepId yet) to the primary lane, without dropping it", () => {
    const a = step("a");
    const b = step("b", "a");
    const temp = step("step-1"); // makeStep()'s shape: no parentStepId until persisted
    const graph = buildLaneGraph([a, b, temp]);
    const total = graph.lanes.reduce((sum, l) => sum + l.steps.length, 0);
    expect(total).toBe(3);
    expect(graph.laneOfStepId["step-1"]).toBe(graph.primaryLaneId);
    const primary = graph.lanes.find((l) => l.id === graph.primaryLaneId)!;
    expect(primary.steps.map((s) => s.id)).toEqual(["a", "b", "step-1"]);
  });
});

describe("flattenLaneGraph", () => {
  it("re-flattens a pure chain unchanged", () => {
    const a = step("a");
    const b = step("b", "a");
    const c = step("c", "b");
    const graph = buildLaneGraph([a, b, c]);
    expect(flattenLaneGraph(graph).map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("emits a lane before the step it's attached to, generalizing the tail-before-trunk convention", () => {
    const a = step("a");
    const t1 = step("t1", "a");
    const b = step("b", "a");
    const graph = buildLaneGraph([a, t1, b]);
    // buildLaneGraph groups [a] as primary, [t1] and [b] as its two child
    // lanes; flattening emits both child lanes (t1 first, by array-order
    // tiebreak) immediately before `a`.
    expect(flattenLaneGraph(graph).map((s) => s.id)).toEqual(["t1", "b", "a"]);
  });
});

// HEL-912 — reorderLane generalizes HEL-908's reorderTrunk from "the trunk"
// to "one lane, any lane". This is also a regression guard for the real bug
// found alongside design.md decision 15: reorder handlers used to index
// directly into the flat array with trunk-relative indices.
describe("reorderLane", () => {
  it("permutes a pure chain with no other lanes (regression guard: behaves like a flat moveStep)", () => {
    const a = step("a");
    const b = step("b", "a");
    const c = step("c", "b");
    const graph = buildLaneGraph([a, b, c]);
    const result = reorderLane(graph, graph.primaryLaneId!, 2, 0);
    expect(result.map((s) => s.id)).toEqual(["c", "a", "b"]);
  });

  it("reordering one lane does not change another lane's steps or relative order", () => {
    const a = step("a");
    const b = step("b", "a");
    const c = step("c", "b");
    const t1 = step("t1", "a");
    const graph = buildLaneGraph([a, b, t1, c]);
    // a has two children (b, t1) -- both root their own lane off a; the
    // primary lane is just [a]. Use b's own lane for the reorder below (b
    // continues into c, a real 2-step lane), and t1 as the OTHER lane that
    // must stay untouched.
    const bLaneId = childLanesOf(graph, "a").find((l) => l.steps[0].id === "b")!.id;
    const tailLaneId = childLanesOf(graph, "a").find((l) => l.steps[0].id === "t1")!.id;
    expect(tailLaneId).toBe("t1");

    const result = reorderLane(graph, bLaneId, 0, 1); // within b's lane: [b,c] -> [c,b]
    const rebuilt = buildLaneGraph(result);
    const primary = rebuilt.lanes.find((l) => l.id === rebuilt.primaryLaneId)!;
    expect(primary.steps.map((s) => s.id)).toEqual(["a"]);
    // b's own lane is reordered ([b,c] -> [c,b])...
    const bLaneAfter = childLanesOf(rebuilt, "a").find(
      (l) => l.steps[0].id === "c" || l.steps[0].id === "b",
    )!;
    expect(bLaneAfter.steps.map((s) => s.id)).toEqual(["c", "b"]);
    // ...while t1's own lane, still attached to `a`, is untouched -- "the
    // tail follows its trunk step."
    expect(childLanesOf(rebuilt, "a")).toHaveLength(2);
    const t1LaneAfter = childLanesOf(rebuilt, "a").find((l) => l.steps[0].id === "t1")!;
    expect(t1LaneAfter.steps.map((s) => s.id)).toEqual(["t1"]);
  });

  it("MUTATION PROOF: a naive flat moveStep on the same shape would misclassify the lane", () => {
    const a = step("a");
    const b = step("b", "a");
    const c = step("c", "b");
    const t1 = step("t1", "a");
    const flat = [a, t1, b, c]; // buildLaneGraph's flat input shape
    function naiveMoveStep<T>(items: T[], fromIndex: number, toIndex: number): T[] {
      const next = [...items];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    }
    const naiveResult = naiveMoveStep(flat, 0, 1);
    expect(naiveResult.map((s) => s.id)).toEqual(["t1", "a", "b", "c"]);
    const naiveRebuilt = buildLaneGraph(naiveResult);
    const naivePrimary = naiveRebuilt.lanes.find((l) => l.id === naiveRebuilt.primaryLaneId)!;
    // Confirmed RED: the naive approach's re-derived primary lane is WRONG
    // -- it did not move `a` after `b` at all.
    expect(naivePrimary.steps.map((s) => s.id)).not.toEqual(["b", "a", "c"]);
  });
});
