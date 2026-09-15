// stepNarrowing.test.ts — HEL-384: union's picker inclusion, default config
// seed, and unionConfigOf narrowing helper. No pre-existing stepNarrowing
// test file covered join's narrowing to extend (per task 6.6's fallback: none
// exists for any op today), so this file focuses on the union additions.
// HEL-386 extends this file with the equivalent lookup coverage (task 6.6).

import {
  OP_TYPES,
  defaultConfigFor,
  isUnsupportedOpType,
  lookupConfigOf,
  makeStep,
  pipelineStepToStep,
  unionConfigOf,
  unsupportedOpType,
  upsertSourceConfigOf,
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

// HEL-1100 (design.md Decision 9) — an unrecognized persisted step type must render as an
// unsupported placeholder, never silently mis-render as the picker's first op ("Select
// fields"). HEL-1102 registered `upsertsource` as a real op (see the describe block below),
// so this suite now uses a genuinely unregistered made-up kind for the fallback case instead.
describe("stepNarrowing — unsupported op type (HEL-1100)", () => {
  it("pipelineStepToStep falls back to unsupportedOpType for an unrecognized step type, never OP_TYPES[0]", () => {
    // `PipelineStep`'s wire type intentionally does NOT include this made-up kind (design.md
    // D9 — the frontend type stays closed over the kinds it recognizes); a persisted row of an
    // unrecognized kind is exactly what this fallback exists to handle, hence the cast.
    const ps = {
      id: "s1",
      pipelineId: "p1",
      position: 0,
      type: "somefuturestep",
      config: { foo: "bar" },
      createdAt: "",
      updatedAt: "",
      enabled: true,
    } as unknown as PipelineStep;
    const step = pipelineStepToStep(ps);
    expect(step.opType.id).not.toBe(OP_TYPES[0].id);
    expect(isUnsupportedOpType(step.opType)).toBe(true);
    expect(step.opType.label).toContain("somefuturestep");
    // The config is carried through UNTOUCHED (design.md D9) — not discarded, not defaulted.
    expect(step.config).toEqual(ps.config);
  });

  it("isUnsupportedOpType is false for every real OP_TYPES entry", () => {
    OP_TYPES.forEach((op) => {
      expect(isUnsupportedOpType(op)).toBe(false);
    });
  });

  it("unsupportedOpType ids are namespaced so they can never collide with a real OpType id", () => {
    expect(unsupportedOpType("somefuturestep").id).toBe("unsupported:somefuturestep");
  });
});

// HEL-1102 (design.md Decisions 3/4) — `upsertsource` is now a real, registered op: OP_TYPES
// entry, seed config, and narrowing all resolve it to the real OpType, not unsupportedOpType.
describe("stepNarrowing — upsertsource (HEL-1102)", () => {
  it("upsertsource is offered in the OP_TYPES picker", () => {
    expect(OP_TYPES.some((op) => op.id === "upsertsource")).toBe(true);
  });

  it("defaultConfigFor('upsertsource') seeds mode:'append' with no target key", () => {
    const config = defaultConfigFor("upsertsource");
    expect(config).toEqual({ mode: "append" });
    expect(config).not.toHaveProperty("target");
  });

  it("pipelineStepToStep resolves a persisted upsertsource step to the real OpType, not unsupportedOpType", () => {
    const ps = {
      id: "s1",
      pipelineId: "p1",
      position: 0,
      type: "upsertsource",
      config: { target: { kind: "existingSource", dataSourceId: "ds-1" }, mode: "replace" },
      createdAt: "",
      updatedAt: "",
      enabled: true,
    } as unknown as PipelineStep;
    const step = pipelineStepToStep(ps);
    expect(isUnsupportedOpType(step.opType)).toBe(false);
    expect(step.opType.id).toBe("upsertsource");
    expect(step.config).toEqual(ps.config);
  });

  it("upsertSourceConfigOf narrows a persisted step's config, target possibly absent", () => {
    const opType = OP_TYPES.find((op) => op.id === "upsertsource");
    if (!opType) throw new Error("upsertsource missing from OP_TYPES");
    const step: Step = {
      id: "step-1",
      opType,
      label: opType.label,
      config: { mode: "append" },
      enabled: true,
    };
    expect(upsertSourceConfigOf(step)).toEqual({ target: undefined, mode: "append" });
  });

  // evaluation-1.md CR1: this is the REAL round-tripped shape the backend returns for a
  // freshly-added, not-yet-configured step -- `UpsertSourceConfig.decode` substitutes
  // `UpsertTarget.Default = ExistingSource("")` for an absent `target`, and `format.write`
  // always serializes a concrete object, so `target` is NEVER actually absent on the wire.
  // Live-reproduced by the evaluator via a real add-step + refetch against the running backend.
  it("upsertSourceConfigOf treats the backend's own ExistingSource('') round-trip sentinel as no target chosen (evaluation-1.md CR1)", () => {
    const opType = OP_TYPES.find((op) => op.id === "upsertsource");
    if (!opType) throw new Error("upsertsource missing from OP_TYPES");
    const step: Step = {
      id: "step-1",
      opType,
      label: opType.label,
      config: { target: { kind: "existingSource", dataSourceId: "" }, mode: "append" },
      enabled: true,
    };
    expect(upsertSourceConfigOf(step)).toEqual({ target: undefined, mode: "append" });
  });

  it("upsertSourceConfigOf narrows a fully-configured existingSource/replace step", () => {
    const opType = OP_TYPES.find((op) => op.id === "upsertsource");
    if (!opType) throw new Error("upsertsource missing from OP_TYPES");
    const step: Step = {
      id: "step-1",
      opType,
      label: opType.label,
      config: { target: { kind: "existingSource", dataSourceId: "ds-1" }, mode: "replace" },
      enabled: true,
    };
    expect(upsertSourceConfigOf(step)).toEqual({
      target: { kind: "existingSource", dataSourceId: "ds-1" },
      mode: "replace",
    });
  });

  it("upsertSourceConfigOf falls back to defaults for a non-upsertsource step", () => {
    const nonUpsertOpType = OP_TYPES.find((op) => op.id === "select");
    if (!nonUpsertOpType) throw new Error("select missing from OP_TYPES");
    const step: Step = {
      id: "step-2",
      opType: nonUpsertOpType,
      label: nonUpsertOpType.label,
      config: { fields: [] },
      enabled: true,
    };
    expect(upsertSourceConfigOf(step)).toEqual({ target: undefined, mode: "append" });
  });
});
