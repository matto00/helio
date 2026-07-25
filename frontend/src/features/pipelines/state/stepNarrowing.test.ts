// stepNarrowing.test.ts — HEL-384: union's picker inclusion, default config
// seed, and unionConfigOf narrowing helper. No pre-existing stepNarrowing
// test file covered join's narrowing to extend (per task 6.6's fallback: none
// exists for any op today), so this file focuses on the union additions.

import { OP_TYPES, defaultConfigFor, unionConfigOf } from "./stepNarrowing";
import type { UnionConfig } from "../types/pipelineStep";
import type { Step } from "../types/step";

function makeUnionStep(config: UnionConfig): Step {
  const opType = OP_TYPES.find((op) => op.id === "union");
  if (!opType) throw new Error("union missing from OP_TYPES");
  return { id: "step-1", opType, label: opType.label, config };
}

describe("stepNarrowing — union", () => {
  it("union is offered in the OP_TYPES picker", () => {
    expect(OP_TYPES.some((op) => op.id === "union")).toBe(true);
  });

  it("defaultConfigFor('union') seeds an empty otherDataSourceId and byPosition mode", () => {
    expect(defaultConfigFor("union")).toEqual({ otherDataSourceId: "", mode: "byPosition" });
  });

  it("unionConfigOf narrows a union step's config", () => {
    const step = makeUnionStep({ otherDataSourceId: "ds-2", mode: "byName" });
    expect(unionConfigOf(step)).toEqual({ otherDataSourceId: "ds-2", mode: "byName" });
  });

  it("unionConfigOf falls back to defaults for a non-union step", () => {
    const nonUnionOpType = OP_TYPES.find((op) => op.id === "select");
    if (!nonUnionOpType) throw new Error("select missing from OP_TYPES");
    const step: Step = {
      id: "step-2",
      opType: nonUnionOpType,
      label: nonUnionOpType.label,
      config: { fields: [] },
    };
    expect(unionConfigOf(step)).toEqual({ otherDataSourceId: "", mode: "byPosition" });
  });

  it("unionConfigOf falls back to byPosition for an unrecognized mode value", () => {
    const step = makeUnionStep({
      otherDataSourceId: "ds-2",
      mode: "byColumn" as UnionConfig["mode"],
    });
    expect(unionConfigOf(step)).toEqual({ otherDataSourceId: "ds-2", mode: "byPosition" });
  });
});
