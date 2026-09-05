// nodePath.test.ts — HEL-968 task 5.4 (design.md Decision 3, R5). Confirms
// the runtime graph path format (`root:<rootId> > s1 > s4`), that a
// multi-root-reachable node resolves through the lowest-positioned root,
// and that the stale single-root bare-`root` head (`root > s1 > s4`) is
// never produced.

import { nodePath } from "./nodePath";
import { OP_TYPES } from "./stepNarrowing";
import type { LaneGraphRoot } from "./stepTree";
import type { Step } from "../types/step";

const FILTER_OP = OP_TYPES.find((op) => op.id === "filter")!;
const UNION_OP = OP_TYPES.find((op) => op.id === "union")!;

function step(id: string, parentStepId?: string, rootId?: string): Step {
  return {
    id,
    opType: FILTER_OP,
    label: FILTER_OP.label,
    config: { combinator: "AND", conditions: [] },
    enabled: true,
    parentStepId,
    rootId: parentStepId ? undefined : rootId,
  };
}

function unionStep(id: string, parentStepId: string, secondaryStepId: string): Step {
  return {
    id,
    opType: UNION_OP,
    label: UNION_OP.label,
    config: {
      secondaryInput: { kind: "lane", stepId: secondaryStepId },
      mode: "byPosition",
    },
    enabled: true,
    parentStepId,
  };
}

describe("nodePath", () => {
  it("renders a root-level step as root:<rootId> > <stepId>", () => {
    const roots: LaneGraphRoot[] = [{ id: "r1" }];
    const a = step("a", undefined, "r1");
    expect(nodePath("a", [a], roots)).toBe("root:r1 > a");
  });

  it("renders a chain's runtime path with every intermediate id, root-to-leaf", () => {
    const roots: LaneGraphRoot[] = [{ id: "r1" }];
    const a = step("a", undefined, "r1");
    const b = step("b", "a");
    const c = step("c", "b");
    const steps = [a, b, c];
    expect(nodePath("c", steps, roots)).toBe("root:r1 > a > b > c");
  });

  // AC3 — the stale single-root format (`root > s1 > s4`, no rootId) must
  // never be produced under multi-root.
  it("never produces the stale single-root bare-`root` head", () => {
    const roots: LaneGraphRoot[] = [{ id: "r1" }];
    const a = step("a", undefined, "r1");
    const b = step("b", "a");
    const path = nodePath("b", [a, b], roots);
    expect(path).not.toMatch(/^root >/);
    expect(path).not.toMatch(/^root(?!:)/); // never a bare "root" token
    expect(path.startsWith("root:r1")).toBe(true);
  });

  it("a node reachable from several roots resolves through the LOWEST-positioned root", () => {
    const roots: LaneGraphRoot[] = [{ id: "r1" }, { id: "r2" }];
    const a = step("a", undefined, "r1"); // root 0's lane
    const x = step("x", undefined, "r2"); // root 1's lane
    // A rejoin off r2's lane, consuming a's lane too -- reachable from BOTH roots.
    const rejoin = unionStep("j", "x", "a");
    const steps = [a, x, rejoin];
    // Canonical path goes through r1 (position 0), not r2, even though the
    // rejoin's OWN parent chain is rooted at r2.
    expect(nodePath("j", steps, roots)).toBe("root:r1 > a > j");
  });

  it("falls back to the bare step id for unresolvable/malformed data rather than throwing", () => {
    expect(nodePath("missing", [], [{ id: "r1" }])).toBe("missing");
  });
});
