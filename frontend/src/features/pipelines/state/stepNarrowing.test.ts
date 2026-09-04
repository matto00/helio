// stepNarrowing.test.ts — HEL-384: union's picker inclusion, default config
// seed, and unionConfigOf narrowing helper. No pre-existing stepNarrowing
// test file covered join's narrowing to extend (per task 6.6's fallback: none
// exists for any op today), so this file focuses on the union additions.
// HEL-386 extends this file with the equivalent lookup coverage (task 6.6).

import {
  OP_TYPES,
  defaultConfigFor,
  lookupConfigOf,
  makeStep,
  pipelineStepToStep,
  unionConfigOf,
} from "./stepNarrowing";
import type { LookupConfig, PipelineStep, UnionConfig } from "../types/pipelineStep";
import type { Step } from "../types/step";

function makeUnionStep(config: UnionConfig): Step {
  const opType = OP_TYPES.find((op) => op.id === "union");
  if (!opType) throw new Error("union missing from OP_TYPES");
  return { id: "step-1", opType, label: opType.label, config, enabled: true };
}

function makeLookupStep(config: LookupConfig): Step {
  const opType = OP_TYPES.find((op) => op.id === "lookup");
  if (!opType) throw new Error("lookup missing from OP_TYPES");
  return { id: "step-1", opType, label: opType.label, config, enabled: true };
}

describe("stepNarrowing — union", () => {
  it("union is offered in the OP_TYPES picker", () => {
    expect(OP_TYPES.some((op) => op.id === "union")).toBe(true);
  });

  it("defaultConfigFor('union') seeds an empty source secondaryInput and byPosition mode", () => {
    expect(defaultConfigFor("union")).toEqual({
      secondaryInput: { kind: "source", dataSourceId: "" },
      mode: "byPosition",
    });
  });

  it("unionConfigOf narrows a source-kind union step's config", () => {
    const step = makeUnionStep({
      secondaryInput: { kind: "source", dataSourceId: "ds-2" },
      mode: "byName",
    });
    expect(unionConfigOf(step)).toEqual({
      secondary: { kind: "source", dataSourceId: "ds-2" },
      mode: "byName",
    });
  });

  // HEL-912 (design.md Decision 4) — REPLACES the HEL-911 "degrade lane-kind
  // to empty string" pin this test file used to carry
  // (`unionConfigOf(step)` on a lane-kind config used to collapse to
  // `{ otherDataSourceId: "", mode: "byPosition" }`, silently discarding the
  // stored lane reference). The narrowed value now carries the full
  // discriminated `secondary` arm straight through instead of degrading it
  // — see task 5.6's full save/reload round-trip proof in
  // `hooks/useStepCardState.test.ts` ("round-trips a stored lane-kind
  // secondaryInput"), which exercises the actual persist path this
  // read-only narrowing test doesn't.
  it("unionConfigOf narrows a lane-kind union step's config WITHOUT discarding it", () => {
    const step = makeUnionStep({
      secondaryInput: { kind: "lane", stepId: "step-7" },
      mode: "byPosition",
    });
    expect(unionConfigOf(step)).toEqual({
      secondary: { kind: "lane", stepId: "step-7" },
      mode: "byPosition",
    });
  });

  it("unionConfigOf falls back to defaults for a non-union step", () => {
    const nonUnionOpType = OP_TYPES.find((op) => op.id === "select");
    if (!nonUnionOpType) throw new Error("select missing from OP_TYPES");
    const step: Step = {
      id: "step-2",
      opType: nonUnionOpType,
      label: nonUnionOpType.label,
      config: { fields: [] },
      enabled: true,
    };
    expect(unionConfigOf(step)).toEqual({
      secondary: { kind: "source", dataSourceId: "" },
      mode: "byPosition",
    });
  });

  it("unionConfigOf falls back to byPosition for an unrecognized mode value", () => {
    const step = makeUnionStep({
      secondaryInput: { kind: "source", dataSourceId: "ds-2" },
      mode: "byColumn" as UnionConfig["mode"],
    });
    expect(unionConfigOf(step)).toEqual({
      secondary: { kind: "source", dataSourceId: "ds-2" },
      mode: "byPosition",
    });
  });
});

describe("stepNarrowing — lookup", () => {
  it("lookup is offered in the OP_TYPES picker", () => {
    expect(OP_TYPES.some((op) => op.id === "lookup")).toBe(true);
  });

  it("defaultConfigFor('lookup') seeds empty ids/keys and an empty columns list", () => {
    expect(defaultConfigFor("lookup")).toEqual({
      secondaryInput: { kind: "source", dataSourceId: "" },
      sourceKey: "",
      lookupKey: "",
      columns: [],
    });
  });

  it("lookupConfigOf narrows a source-kind lookup step's config", () => {
    const step = makeLookupStep({
      secondaryInput: { kind: "source", dataSourceId: "ds-2" },
      sourceKey: "code",
      lookupKey: "code",
      columns: ["label"],
    });
    expect(lookupConfigOf(step)).toEqual({
      secondary: { kind: "source", dataSourceId: "ds-2" },
      sourceKey: "code",
      lookupKey: "code",
      columns: ["label"],
    });
  });

  // HEL-912 — same replacement as unionConfigOf's lane-kind test above.
  it("lookupConfigOf narrows a lane-kind lookup step's config WITHOUT discarding it", () => {
    const step = makeLookupStep({
      secondaryInput: { kind: "lane", stepId: "step-9" },
      sourceKey: "code",
      lookupKey: "code",
      columns: ["label"],
    });
    expect(lookupConfigOf(step)).toEqual({
      secondary: { kind: "lane", stepId: "step-9" },
      sourceKey: "code",
      lookupKey: "code",
      columns: ["label"],
    });
  });

  it("lookupConfigOf falls back to defaults for a non-lookup step", () => {
    const nonLookupOpType = OP_TYPES.find((op) => op.id === "select");
    if (!nonLookupOpType) throw new Error("select missing from OP_TYPES");
    const step: Step = {
      id: "step-2",
      opType: nonLookupOpType,
      label: nonLookupOpType.label,
      config: { fields: [] },
      enabled: true,
    };
    expect(lookupConfigOf(step)).toEqual({
      secondary: { kind: "source", dataSourceId: "" },
      sourceKey: "",
      lookupKey: "",
      columns: [],
    });
  });
});

// HEL-412 — `Step.enabled` normalize-at-boundary default.
describe("stepNarrowing — enabled (HEL-412)", () => {
  it("makeStep seeds a freshly created step as enabled", () => {
    const opType = OP_TYPES.find((op) => op.id === "select")!;
    expect(makeStep(opType).enabled).toBe(true);
  });

  it("pipelineStepToStep maps a persisted step's enabled flag straight through", () => {
    const ps: PipelineStep = {
      id: "s1",
      pipelineId: "p1",
      position: 0,
      type: "select",
      config: { fields: [] },
      createdAt: "",
      updatedAt: "",
      enabled: false,
    };
    expect(pipelineStepToStep(ps).enabled).toBe(false);
  });

  it("pipelineStepToStep defaults enabled to true when the wire field is absent", () => {
    const ps: PipelineStep = {
      id: "s1",
      pipelineId: "p1",
      position: 0,
      type: "select",
      config: { fields: [] },
      createdAt: "",
      updatedAt: "",
    };
    expect(pipelineStepToStep(ps).enabled).toBe(true);
  });
});
