// stepNarrowing.test.ts — HEL-384: union's picker inclusion, default config
// seed, and unionConfigOf narrowing helper. No pre-existing stepNarrowing
// test file covered join's narrowing to extend (per task 6.6's fallback: none
// exists for any op today), so this file focuses on the union additions.
// HEL-386 extends this file with the equivalent lookup coverage (task 6.6).

import {
  OP_TYPES,
  STEP_ICONS,
  analyzeWithAiConfigOf,
  convertFormatConfigOf,
  defaultConfigFor,
  generateTextConfigOf,
  isCompleteAiStepConfig,
  isUnsupportedOpType,
  lookupConfigOf,
  makeStep,
  pipelineStepToStep,
  requiresCompleteConfigForCreate,
  resolveDraftFallbackSchema,
  unionConfigOf,
  unsupportedOpType,
  upsertSourceConfigOf,
} from "./stepNarrowing";
import type {
  AnalyzeWithAiConfig,
  ConvertFormatConfig,
  GenerateTextConfig,
  LookupConfig,
  PipelineStep,
  UnionConfig,
} from "../types/pipelineStep";
import type { Step } from "../types/step";

function makeStepOfKind<T>(kind: string, config: T): Step {
  const opType = OP_TYPES.find((op) => op.id === kind);
  if (!opType) throw new Error(`${kind} missing from OP_TYPES`);
  return { id: "step-1", opType, label: opType.label, config: config as never, enabled: true };
}

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

describe("stepNarrowing — HEL-1109 convertformat/analyzewithai/generatetext", () => {
  it("all three ops are offered in the OP_TYPES picker", () => {
    expect(OP_TYPES.some((op) => op.id === "convertformat")).toBe(true);
    expect(OP_TYPES.some((op) => op.id === "analyzewithai")).toBe(true);
    expect(OP_TYPES.some((op) => op.id === "generatetext")).toBe(true);
  });

  // design.md D3's central trap: the seed must OMIT from/to, not seed them ""
  // like every sibling string field -- a present-and-empty pair is a 422.
  it("defaultConfigFor('convertformat') omits from/to entirely, not merely leaves them empty", () => {
    const seed = defaultConfigFor("convertformat") as ConvertFormatConfig;
    expect(seed).toEqual({ field: "" });
    expect("from" in seed).toBe(false);
    expect("to" in seed).toBe(false);
  });

  it("defaultConfigFor seeds analyzewithai/generatetext with the shapes their cards edit locally", () => {
    expect(defaultConfigFor("analyzewithai")).toEqual({
      inputField: "",
      instruction: "",
      outputSchema: [],
    });
    expect(defaultConfigFor("generatetext")).toEqual({
      inputField: "",
      instruction: "",
      outputField: "",
    });
  });

  it("convertFormatConfigOf narrows a persisted config, including an unsupported legacy pair", () => {
    const step = makeStepOfKind<ConvertFormatConfig>("convertformat", {
      field: "body",
      from: "csv",
      to: "csv",
      outputField: "converted",
    });
    expect(convertFormatConfigOf(step)).toEqual({
      field: "body",
      from: "csv",
      to: "csv",
      outputField: "converted",
    });
  });

  it("convertFormatConfigOf covers an absent config gracefully for a non-convertformat step", () => {
    const step = makeStepOfKind("select", { fields: [] });
    expect(convertFormatConfigOf(step)).toEqual({ field: "" });
  });

  it("analyzeWithAiConfigOf narrows a persisted config, preserving outputSchema order", () => {
    const step = makeStepOfKind<AnalyzeWithAiConfig>("analyzewithai", {
      inputField: "text",
      instruction: "Extract sentiment",
      outputSchema: [
        { name: "sentiment", type: "string" },
        { name: "confidence", type: "float" },
      ],
    });
    expect(analyzeWithAiConfigOf(step)).toEqual({
      inputField: "text",
      instruction: "Extract sentiment",
      outputSchema: [
        { name: "sentiment", type: "string" },
        { name: "confidence", type: "float" },
      ],
    });
  });

  it("analyzeWithAiConfigOf covers a partial persisted config", () => {
    const step = makeStepOfKind<Partial<AnalyzeWithAiConfig>>("analyzewithai", {
      inputField: "text",
    });
    expect(analyzeWithAiConfigOf(step)).toEqual({
      inputField: "text",
      instruction: "",
      outputSchema: [],
    });
  });

  it("generateTextConfigOf narrows a persisted config", () => {
    const step = makeStepOfKind<GenerateTextConfig>("generatetext", {
      inputField: "notes",
      instruction: "Summarize",
      outputField: "summary",
    });
    expect(generateTextConfigOf(step)).toEqual({
      inputField: "notes",
      instruction: "Summarize",
      outputField: "summary",
    });
  });

  it("generateTextConfigOf covers an absent config", () => {
    const step = makeStepOfKind("select", { fields: [] });
    expect(generateTextConfigOf(step)).toEqual({
      inputField: "",
      instruction: "",
      outputField: "",
    });
  });

  // design.md D3 — [C2]: mutating the SOURCE OF TRUTH (the set of kinds this
  // predicate consults), not a hardcoded twin, proves the guard fails in the
  // direction of its stated purpose.
  describe("requiresCompleteConfigForCreate", () => {
    it("is true for exactly analyzewithai and generatetext", () => {
      const deferred = OP_TYPES.filter((op) => requiresCompleteConfigForCreate(op.id)).map(
        (op) => op.id,
      );
      expect(deferred.sort()).toEqual(["analyzewithai", "generatetext"]);
    });

    it("is false for convertformat and every other existing op", () => {
      expect(requiresCompleteConfigForCreate("convertformat")).toBe(false);
      expect(requiresCompleteConfigForCreate("select")).toBe(false);
      expect(requiresCompleteConfigForCreate("upsertsource")).toBe(false);
    });
  });

  describe("isCompleteAiStepConfig", () => {
    it("rejects an empty analyzewithai draft (the exact seed defaultConfigFor produces)", () => {
      expect(isCompleteAiStepConfig("analyzewithai", defaultConfigFor("analyzewithai"))).toBe(
        false,
      );
    });

    it("accepts a fully-specified analyzewithai config", () => {
      const cfg: AnalyzeWithAiConfig = {
        inputField: "text",
        instruction: "Extract sentiment",
        outputSchema: [{ name: "sentiment", type: "string" }],
      };
      expect(isCompleteAiStepConfig("analyzewithai", cfg)).toBe(true);
    });

    it("rejects an analyzewithai config with an empty outputSchema", () => {
      const cfg: AnalyzeWithAiConfig = {
        inputField: "text",
        instruction: "Extract sentiment",
        outputSchema: [],
      };
      expect(isCompleteAiStepConfig("analyzewithai", cfg)).toBe(false);
    });

    it("rejects an analyzewithai config with a duplicate declared name", () => {
      const cfg: AnalyzeWithAiConfig = {
        inputField: "text",
        instruction: "x",
        outputSchema: [
          { name: "a", type: "string" },
          { name: "a", type: "integer" },
        ],
      };
      expect(isCompleteAiStepConfig("analyzewithai", cfg)).toBe(false);
    });

    it("rejects an analyzewithai config whose declared name collides with inputField", () => {
      const cfg: AnalyzeWithAiConfig = {
        inputField: "text",
        instruction: "x",
        outputSchema: [{ name: "text", type: "string" }],
      };
      expect(isCompleteAiStepConfig("analyzewithai", cfg)).toBe(false);
    });

    it("rejects an empty generatetext draft", () => {
      expect(isCompleteAiStepConfig("generatetext", defaultConfigFor("generatetext"))).toBe(false);
    });

    it("accepts a fully-specified generatetext config", () => {
      const cfg: GenerateTextConfig = {
        inputField: "notes",
        instruction: "Summarize",
        outputField: "summary",
      };
      expect(isCompleteAiStepConfig("generatetext", cfg)).toBe(true);
    });

    it("rejects a generatetext config with a whitespace-only outputField", () => {
      const cfg: GenerateTextConfig = {
        inputField: "notes",
        instruction: "Summarize",
        outputField: "   ",
      };
      expect(isCompleteAiStepConfig("generatetext", cfg)).toBe(false);
    });

    it("treats every non-AI kind as always complete", () => {
      expect(isCompleteAiStepConfig("convertformat", { field: "" })).toBe(true);
    });
  });
});

describe("stepNarrowing — HEL-1136 drift guard: STEP_ICONS vs. backend registry authorability", () => {
  // Task 4.1 — parses the same Scala source of truth
  // `canonicalFieldTypesDriftGuard.test.ts` uses, from repo root. `join` is
  // the one deliberate OP_TYPES exclusion (stepNarrowing.ts comment above
  // OP_TYPES) -- every other Registry-registered kind must have an OP_TYPES
  // entry, or a persisted/agent-created step of that kind renders as
  // "unsupported" with no way to author it in the UI.
  const path = require("path") as typeof import("path");
  const fs = require("fs") as typeof import("fs");

  function findRepoRoot(startDir: string): string {
    let dir = startDir;
    for (let i = 0; i < 10; i++) {
      if (fs.existsSync(path.join(dir, "backend", "src", "main"))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    throw new Error("Could not locate repo root (backend/src/main) from " + startDir);
  }

  // `PipelineStep.Registry` maps each `XxxStep.Kind -> XxxStep.companion` --
  // the KEY is a reference, not a string literal, so the real kind string
  // lives in each step's own file (`val Kind: String = "..."`). Resolving it
  // there (rather than assuming `XxxStep` lowercases to its kind) is what
  // makes this guard immune to a step class name that doesn't match its wire
  // kind string.
  function parseRegistryStepNames(source: string): string[] {
    const registryBlockMatch = source.match(/val Registry[\s\S]*?Map\(([\s\S]*?)\n\s*\)/);
    if (!registryBlockMatch) throw new Error("Could not locate PipelineStep.Registry block");
    const block = registryBlockMatch[1];
    const names: string[] = [];
    const re = /(\w+Step)\.Kind\s*->/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block)) !== null) {
      names.push(m[1]);
    }
    return names;
  }

  function resolveKindString(repoRoot: string, stepClassName: string): string {
    const stepFile = path.join(
      repoRoot,
      "backend/src/main/scala/com/helio/domain/steps",
      `${stepClassName}.scala`,
    );
    const source = fs.readFileSync(stepFile, "utf8");
    const match = source.match(/val Kind:\s*String\s*=\s*"([a-zA-Z]+)"/);
    if (!match) throw new Error(`Could not find "val Kind" in ${stepFile}`);
    return match[1];
  }

  function parseRegistryKinds(repoRoot: string, source: string): string[] {
    return parseRegistryStepNames(source).map((name) => resolveKindString(repoRoot, name));
  }

  // HEL-1136 task 6.3 (design.md Decision 8) — replaces the old
  // `KNOWN_UNLISTED_KINDS` hardcoded frontend exception list: authorability is
  // now a BACKEND declaration (`override def authorable: Boolean = false` on
  // a companion), parsed here from the real step files rather than
  // re-asserted as a frontend constant, so a future backend-declared
  // unauthorable kind doesn't require touching this test at all.
  function parseUnauthorableKinds(repoRoot: string, registryKinds: string[]): Set<string> {
    const stepsDir = path.join(repoRoot, "backend/src/main/scala/com/helio/domain/steps");
    const unauthorable = new Set<string>();
    for (const file of fs.readdirSync(stepsDir)) {
      if (!file.endsWith("Step.scala")) continue;
      const source = fs.readFileSync(path.join(stepsDir, file), "utf8");
      const kindMatch = source.match(/val Kind:\s*String\s*=\s*"([a-zA-Z]+)"/);
      if (!kindMatch) continue;
      const kind = kindMatch[1];
      if (
        registryKinds.includes(kind) &&
        /override def authorable: Boolean\s*=\s*false/.test(source)
      ) {
        unauthorable.add(kind);
      }
    }
    return unauthorable;
  }

  function iconsCoverAuthorableKinds(
    registryKinds: string[],
    unauthorableKinds: Set<string>,
  ): { missing: string[] } {
    const authorableKinds = registryKinds.filter((k) => !unauthorableKinds.has(k));
    const missing = authorableKinds.filter((k) => !(k in STEP_ICONS));
    return { missing };
  }

  it("STEP_ICONS has an entry for every authorable backend-registered kind", () => {
    const repoRoot = findRepoRoot(__dirname);
    const source = fs.readFileSync(
      path.join(repoRoot, "backend/src/main/scala/com/helio/domain/model/PipelineStep.scala"),
      "utf8",
    );
    const registryKinds = parseRegistryKinds(repoRoot, source);
    expect(registryKinds.length).toBe(27);
    const unauthorableKinds = parseUnauthorableKinds(repoRoot, registryKinds);
    // The two currently-declared unauthorable kinds (join, groupby) — asserted here so a future
    // backend declaration change is visible in this test's failure, not silently absorbed.
    expect(unauthorableKinds).toEqual(new Set(["join", "groupby"]));
    const { missing } = iconsCoverAuthorableKinds(registryKinds, unauthorableKinds);
    expect(missing).toEqual([]);
  });

  // [C2] — proven failable in the direction of its STATED PURPOSE by mutating the parsed source
  // of truth (a fake registry kind list), not a hardcoded twin of STEP_ICONS.
  it("fails when an authorable kind has no STEP_ICONS entry (guard is provably not vacuous)", () => {
    const fakeRegistryKinds = ["select", "rename", "totallyMadeUpOpKind"];
    const { missing } = iconsCoverAuthorableKinds(fakeRegistryKinds, new Set());
    expect(missing).toEqual(["totallyMadeUpOpKind"]);
  });
});

describe("resolveDraftFallbackSchema (HEL-1109 evaluation-1.md CR2 / skeptic-final-1.md)", () => {
  // Extracted as a pure function specifically so a test can control `steps`
  // ARRAY ORDER and `meta.parentStepId` INDEPENDENTLY -- the two things a
  // live UI-driven test cannot actually force to disagree, since
  // `handleAddLaneStep`'s own insertion (`anchorIndex + 1`) always keeps a
  // fresh draft array-adjacent to its true anchor.
  const draftStep = {
    id: "draft-1",
    opType: OP_TYPES[0],
    label: "x",
    config: {},
    enabled: true,
  } as Step;

  function schemaOf(name: string): { outputSchema: { name: string; type: string }[] } {
    return { outputSchema: [{ name, type: "string" }] };
  }

  // Scenario 2, made discriminating: the step array-adjacent to the draft
  // (by raw index) is a DIFFERENT step than the draft's real anchor
  // (`meta.parentStepId`) -- a state a live "+lane" click can never actually
  // produce (see the function's own doc comment), but which distinguishes
  // "resolve via the anchor" from "resolve via array position" cleanly.
  it("a lane draft (meta.parentStepId set) resolves from its TRUE anchor, not the array-adjacent step", () => {
    const anchorStep = {
      id: "anchor-1",
      opType: OP_TYPES[0],
      label: "x",
      config: {},
      enabled: true,
    } as Step;
    const unrelatedStep = {
      id: "unrelated-1",
      opType: OP_TYPES[0],
      label: "x",
      config: {},
      enabled: true,
    } as Step;
    // Contrived array order: the step immediately BEFORE the draft (by raw
    // index) is `unrelatedStep`, not `anchorStep` -- exactly the disagreement
    // a live "+lane" insertion can never produce.
    const steps = [anchorStep, unrelatedStep, draftStep];
    const entries: Record<string, { outputSchema: { name: string; type: string }[] }> = {
      [anchorStep.id]: schemaOf("anchor_field"),
      [unrelatedStep.id]: schemaOf("unrelated_field"),
    };
    const result = resolveDraftFallbackSchema(
      draftStep.id,
      steps,
      (id) => entries[id],
      () => [],
      { parentStepId: anchorStep.id },
    );
    expect(result).toEqual([{ name: "anchor_field", type: "string" }]);
  });

  it("a trunk draft (no parentStepId) walks backward to the nearest preceding step with an analyze entry", () => {
    const stepA = { id: "a-1", opType: OP_TYPES[0], label: "x", config: {}, enabled: true } as Step;
    const stepB = { id: "b-1", opType: OP_TYPES[0], label: "x", config: {}, enabled: true } as Step;
    const steps = [stepA, stepB, draftStep];
    const entries: Record<string, { outputSchema: { name: string; type: string }[] }> = {
      [stepA.id]: schemaOf("a_field"),
      [stepB.id]: schemaOf("b_field"),
    };
    const result = resolveDraftFallbackSchema(
      draftStep.id,
      steps,
      (id) => entries[id],
      () => [],
      undefined,
    );
    expect(result).toEqual([{ name: "b_field", type: "string" }]);
  });

  // Scenario 4 — multi-root: the ultimate fallback (no anchor entry found)
  // must match the draft's OWN root, not unconditionally whichever root
  // `getRootSourceSchema` would return first.
  it("falls back to the OWNING root's source schema on a multi-root pipeline, not always the first root", () => {
    const rootSchemas: Record<string, { name: string; type: string }[]> = {
      "root-1": [{ name: "root1_field", type: "string" }],
      "root-2": [{ name: "root2_field", type: "string" }],
    };
    const getRootSourceSchema = (rootId: string | undefined) =>
      rootId ? (rootSchemas[rootId] ?? []) : rootSchemas["root-1"];

    const result = resolveDraftFallbackSchema(
      draftStep.id,
      [draftStep],
      () => undefined,
      getRootSourceSchema,
      { rootId: "root-2" },
    );
    expect(result).toEqual([{ name: "root2_field", type: "string" }]);
  });

  it("a lane draft whose anchor has no analyze entry falls back to the anchor's OWN root, not the first root", () => {
    const rootSchemas: Record<string, { name: string; type: string }[]> = {
      "root-1": [{ name: "root1_field", type: "string" }],
      "root-2": [{ name: "root2_field", type: "string" }],
    };
    const getRootSourceSchema = (rootId: string | undefined) =>
      rootId ? (rootSchemas[rootId] ?? []) : rootSchemas["root-1"];

    const result = resolveDraftFallbackSchema(
      draftStep.id,
      [draftStep],
      () => undefined, // the anchor itself has no analyze entry yet
      getRootSourceSchema,
      { parentStepId: "anchor-in-root-2", rootId: "root-2" },
    );
    expect(result).toEqual([{ name: "root2_field", type: "string" }]);
  });
});
