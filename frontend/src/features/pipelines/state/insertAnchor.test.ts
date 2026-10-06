import type { Step } from "../types/step";
import { computeInsertAnchor, insertWireArgs } from "./insertAnchor";
import { OP_TYPES } from "./stepNarrowing";

const castOp = OP_TYPES.find((o) => o.id === "cast")!;
const step = (id: string, over: Partial<Step> = {}): Step => ({
  id,
  opType: castOp,
  label: "x",
  config: { casts: {} },
  enabled: true,
  position: 0,
  ...over,
});
const roots = [{ id: "r1" }];
const abc = [
  step("a", { rootId: "r1" }),
  step("b", { parentStepId: "a" }),
  step("c", { parentStepId: "b" }),
];

describe("computeInsertAnchor", () => {
  it("is head for gap 0", () => {
    expect(computeInsertAnchor(abc, roots, 0)).toEqual({ kind: "head" });
  });
  it("is the persisted step before the gap", () => {
    expect(computeInsertAnchor(abc, roots, 1)).toEqual({ kind: "after", stepId: "a" });
    expect(computeInsertAnchor(abc, roots, 2)).toEqual({ kind: "after", stepId: "b" });
  });
  it("skips local-only temp steps and falls to head when only temps precede the gap", () => {
    const withTemp = [
      step("step-1", { rootId: "r1" }),
      step("a", { parentStepId: "step-1" }),
      step("step-2", { parentStepId: "a" }),
      step("b", { parentStepId: "step-2" }),
    ];
    expect(computeInsertAnchor(withTemp, roots, 3)).toEqual({ kind: "after", stepId: "a" });
    expect(computeInsertAnchor(withTemp, roots, 1)).toEqual({ kind: "head" });
  });
});

describe("insertWireArgs", () => {
  const present = (id: string) => id !== "gone";
  it("appends with rootId and no position when there is no anchor", () => {
    expect(insertWireArgs(undefined, present, "r1")).toEqual({ rootId: "r1" });
  });
  it("sends rootId + position 0 for head", () => {
    expect(insertWireArgs({ kind: "head" }, present, "r1")).toEqual({ position: 0, rootId: "r1" });
  });
  it("sends parentStepId for a present anchor", () => {
    expect(insertWireArgs({ kind: "after", stepId: "a" }, present, "r1")).toEqual({
      parentStepId: "a",
    });
  });
  it("falls back to an append when the anchor is no longer present", () => {
    expect(insertWireArgs({ kind: "after", stepId: "gone" }, present, "r1")).toEqual({
      rootId: "r1",
    });
  });
});
