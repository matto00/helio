// laneLayout.test.ts — HEL-912 task 2.3.

import { computeAncestorIds, computeLaneLayout, laneOutputSubtitle } from "./laneLayout";
import { buildLaneGraph } from "./stepTree";
import type { LaneGraphRoot } from "./stepTree";
import { OP_TYPES } from "./stepNarrowing";
import type { SecondaryInput } from "../types/pipelineStep";
import type { Step } from "../types/step";

const FILTER_OP = OP_TYPES.find((op) => op.id === "filter")!;
const UNION_OP = OP_TYPES.find((op) => op.id === "union")!;
const ONE_ROOT: LaneGraphRoot[] = [{ id: "root-1" }];

function step(id: string, parentStepId?: string, position?: number, rootId?: string): Step {
  return {
    id,
    opType: FILTER_OP,
    label: FILTER_OP.label,
    config: { combinator: "AND", conditions: [] },
    enabled: true,
    parentStepId,
    position,
    rootId: parentStepId ? rootId : (rootId ?? "root-1"),
  };
}

function unionStep(id: string, parentStepId: string, secondaryInput: SecondaryInput): Step {
  return {
    id,
    opType: UNION_OP,
    label: UNION_OP.label,
    config: { secondaryInput, mode: "byPosition" },
    enabled: true,
    parentStepId,
  };
}

describe("computeLaneLayout", () => {
  it("is deterministic — same input twice, deep-equal output", () => {
    const a = step("a");
    const b = step("b", "a");
    const c = step("c", "a");
    const graph = buildLaneGraph([a, b, c], ONE_ROOT);
    expect(computeLaneLayout(graph)).toEqual(computeLaneLayout(graph));
  });

  it("three siblings get three distinct, adjacent columns in position order", () => {
    const a = step("a");
    const c1 = step("c1", "a", 2);
    const c2 = step("c2", "a", 0);
    const c3 = step("c3", "a", 1);
    const graph = buildLaneGraph([a, c1, c2, c3], ONE_ROOT);
    const layout = computeLaneLayout(graph);
    const cols = [c2, c3, c1].map((s) => layout.slotOfStepId[s.id].lane);
    expect(new Set(cols).size).toBe(3);
    expect(cols).toEqual([cols[0], cols[0] + 1, cols[0] + 2]);
  });

  it("a pure chain is one lane with monotonic rows", () => {
    const a = step("a");
    const b = step("b", "a");
    const c = step("c", "b");
    const graph = buildLaneGraph([a, b, c], ONE_ROOT);
    const layout = computeLaneLayout(graph);
    expect(layout.slotOfStepId["a"]).toEqual({ lane: 0, row: 0 });
    expect(layout.slotOfStepId["b"]).toEqual({ lane: 0, row: 1 });
    expect(layout.slotOfStepId["c"]).toEqual({ lane: 0, row: 2 });
  });

  it("the diamond case: one lane feeding two rejoins", () => {
    const a = step("a");
    const b = step("b", "a"); // lane 1, off a
    const c = step("c", "a"); // lane 2, off a
    const r1 = unionStep("r1", "b", { kind: "lane", stepId: "c" });
    const r2 = unionStep("r2", "c", { kind: "lane", stepId: "b" });
    const graph = buildLaneGraph([a, b, c, r1, r2], ONE_ROOT);
    const layout = computeLaneLayout(graph);
    // c is consumed by r1 (via r1's secondary) and b is consumed by r2.
    expect(layout.rejoinEdges["c"]).toEqual(["r1"]);
    expect(layout.rejoinEdges["b"]).toEqual(["r2"]);
    // r1's row must exceed both its parent (b) and its secondary input (c).
    expect(layout.slotOfStepId["r1"].row).toBeGreaterThan(layout.slotOfStepId["b"].row);
    expect(layout.slotOfStepId["r1"].row).toBeGreaterThan(layout.slotOfStepId["c"].row);
  });

  it("a rejoin on a NON-terminal node — the consumed node keeps its own downstream chain, not dropped", () => {
    const a = step("a");
    const b = step("b", "a");
    const bNext = step("b-next", "b"); // b has its own downstream continuation
    const c = step("c", "a");
    const r = unionStep("r", "c", { kind: "lane", stepId: "b" });
    const graph = buildLaneGraph([a, b, bNext, c, r], ONE_ROOT);
    const layout = computeLaneLayout(graph);
    expect(layout.rejoinEdges["b"]).toEqual(["r"]);
    // b's own chain continuation is untouched.
    expect(layout.slotOfStepId["b-next"].row).toBe(layout.slotOfStepId["b"].row + 1);
  });

  it("a node consumed by SEVERAL rejoins keeps every consumer, none deduplicated or dropped", () => {
    const a = step("a");
    const b = step("b", "a");
    const c = step("c", "a");
    const d = step("d", "a");
    const r1 = unionStep("r1", "c", { kind: "lane", stepId: "b" });
    const r2 = unionStep("r2", "d", { kind: "lane", stepId: "b" });
    const graph = buildLaneGraph([a, b, c, d, r1, r2], ONE_ROOT);
    const layout = computeLaneLayout(graph);
    expect(layout.rejoinEdges["b"]).toEqual(["r1", "r2"]);
  });
});

describe("computeAncestorIds", () => {
  it("includes parentStepId chain and lane-reference chain, excludes non-ancestors", () => {
    const a = step("a");
    const b = step("b", "a");
    const c = step("c", "a");
    const r = unionStep("r", "b", { kind: "lane", stepId: "c" });
    const steps = [a, b, c, r];
    const ancestors = computeAncestorIds(steps, "r");
    expect(ancestors.has("a")).toBe(true);
    expect(ancestors.has("b")).toBe(true);
    expect(ancestors.has("c")).toBe(true);
    expect(ancestors.has("r")).toBe(false);
  });

  it("a sibling lane (no dependency edge) is not an ancestor", () => {
    const a = step("a");
    const b = step("b", "a");
    const c = step("c", "a");
    const steps = [a, b, c];
    const ancestors = computeAncestorIds(steps, "b");
    expect(ancestors.has("c")).toBe(false);
    expect(ancestors.has("a")).toBe(true);
  });
});

describe("laneOutputSubtitle (task 6.1, evaluation-1.md non-blocking suggestion)", () => {
  it("a primary-lane step's subtitle is unchanged -- just its own label", () => {
    const a = step("a", undefined, 0);
    const b = step("b", "a", 0);
    const graph = buildLaneGraph([a, b], ONE_ROOT);
    const labels = new Map([
      ["a", "Filter A"],
      ["b", "Filter B"],
    ]);
    expect(laneOutputSubtitle(graph, labels, "b")).toBe("Filter B");
  });

  it("a non-primary-lane step's subtitle gains a `off <branch step> › lane N › <step>` segment", () => {
    const a = step("a", undefined, 0);
    const tailFirst = step("t1", "a", 1);
    const tailSecond = step("t2", "a", 2);
    const graph = buildLaneGraph([a, tailFirst, tailSecond], ONE_ROOT);
    const labels = new Map([
      ["a", "Filter A"],
      ["t1", "Group & aggregate"],
      ["t2", "Group & aggregate"],
    ]);
    expect(laneOutputSubtitle(graph, labels, "t1")).toBe("Filter A › lane 1 › Group & aggregate");
    expect(laneOutputSubtitle(graph, labels, "t2")).toBe("Filter A › lane 2 › Group & aggregate");
  });
});

// HEL-968 D2/task 4.2 — root-grouped column ordering: a root's lanes are
// contiguous (never interleaved with another root's), root position
// ascending, with the existing sibling-position order preserved WITHIN a
// root.
describe("computeLaneLayout — multi-root column grouping (D2)", () => {
  const TWO_ROOTS: LaneGraphRoot[] = [{ id: "root-1" }, { id: "root-2" }];

  it("is deterministic across two roots (same input, byte-identical output)", () => {
    const a = step("a", undefined, undefined, "root-1");
    const b = step("b", "a");
    const x = step("x", undefined, undefined, "root-2");
    const graph = buildLaneGraph([a, b, x], TWO_ROOTS);
    expect(computeLaneLayout(graph)).toEqual(computeLaneLayout(graph));
  });

  it("every root-1 lane's column index exceeds every root-0 lane's, even when root-0 has its own branch lanes", () => {
    const a = step("a", undefined, undefined, "root-1");
    const aBranch = step("a-branch", "a", 1); // a second, non-continuation lane off root-1's own step
    const x = step("x", undefined, undefined, "root-2");
    const graph = buildLaneGraph([a, aBranch, x], TWO_ROOTS);
    const layout = computeLaneLayout(graph);
    const root1Cols = [a.id, aBranch.id].map((id) => layout.slotOfStepId[id].lane);
    const root2Col = layout.slotOfStepId[x.id].lane;
    expect(Math.max(...root1Cols)).toBeLessThan(root2Col);
  });
});
