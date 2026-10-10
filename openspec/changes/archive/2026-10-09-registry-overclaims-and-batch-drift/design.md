## Context

Premise validation (`.concertino/runs/HEL-1412/evidence/premise-validation.md`) re-derived every claim. Two of the
ticket's checklist layer names are stale: there is no `allowedOps`/`AllowedOps` in `backend/src/main` any more (the
step-type allow-list is `PipelineStepKind.All.contains`, i.e. registry-derived), and StepCard's op dispatch now lives
in `StepOpEditor.tsx`. The NEW comment text below names the layers as they exist on the tree at `c91fffaf6`.

Precedent: HEL-1156 (`ce08a75a1`) rewrote `Panel.scala`'s blocks to "source of truth for X only; name the
hand-enumerated layers; dated snapshot; re-derive command; which gates do and do not fire".

## Goals / Non-Goals

**Goals:** items 1–4 of the ticket, plus the other copies of the same registry overclaim found in the same files
(PipelineStep.scala has five; PipelineService.scala's header repeats it). Close HEL-1149 by covering its AC1–AC4.

**Non-Goals:** changing any code path in Scala; gating pipeline step kinds; the follow-ups listed at the end.

## Decisions

### D1. Item 4 is delivered, not split

The drift change is a ~40-line pure helper module + ~25 lines in the script + 5 selftest cases, all pinned verbatim
below. That is within a pinned Haiku plan, so no split.

### D2. Coverage is derived (HEL-1149 AC3/AC4)

Rather than only appending a 9th hand-listed surface, the script scans every `.json` under `schemas/` and classifies an
`enum` array as a panel-kind enum when it contains ≥2 canonical panel kinds. Measured on `c91fffaf6` (command P20):
the five panel-kind enums carry 5–6 canonical kinds; every other enum carries at most 1 (`"text"` in control-kind /
semantic-role enums, `"markdown"` in Output-kind enums, `"output"` in the patch-set target enum). Threshold 2 separates
them with margin on both sides. Every detected enum must be a checked surface or an exemption with a reason; the
exemption table starts empty. Enum identity is `"<path under schemas/>#<dot-joined JSON path>"`.

Alternative rejected: hand-adding one surface only — leaves HEL-1149 AC3/AC4 unmet and repeats the root cause.

### D3. Surfaces built by one helper

The four `schemas/` surfaces (plus the new one) are built by `schemaEnumSurface(schemaFile, enumPath, canonical)`, which
records `schemaFile`/`enumPath` so the coverage check knows what is checked. Labels become
`schemas/<file> <full dot path>` (slightly longer than before; nothing matches on these labels — P21).

### D4. Exact edits (OLD → NEW, verbatim; each OLD occurs exactly once)

#### E1 — `backend/src/main/scala/com/helio/domain/model/PipelineStep.scala`, file header

OLD:
```
 *  Cycle 1 introduced the typed ADT (sealed-trait) and centralized handlers
 *  + codec. Cycle 3 collapses each kind's data + behavior + codec into one
 *  file so adding an 11th kind means dropping in one step module and adding
 *  one Registry line — no edits in three or four separate central files.
 *
 *  The trait is intentionally NOT `sealed`: Scala 2 constrains sealed-trait
 *  subclasses to the same compilation unit, which would defeat the per-file
 *  refactor. Discipline is enforced via [[PipelineStep.Registry]] — only
 *  kinds registered there round-trip through the codec / protocol / engine.
 *  The four match sites in this codebase (`PipelineStepResponse.fromDomain`,
 *  `PipelineStepConfigCodec.extractConfig`, the protocol writer, the
 *  exhaustiveness test in `PipelineStepSpec`) all enumerate the same 12
 *  subtypes; adding a 13th step kind without updating those is caught by
 *  the kind-set parity test (`PipelineStepKind.All` shouldBe registry.keys).
```
NEW:
```
 *  Cycle 1 introduced the typed ADT and centralized handlers + codec. Cycle 3
 *  moved each kind's config, `evaluate` and config codec into one step file
 *  plus one [[PipelineStep.Registry]] line. That is not the whole cost of a
 *  new kind: many other sites still enumerate kinds by hand (see
 *  [[PipelineStepKind.All]] for that drift surface).
 *
 *  The trait is intentionally NOT `sealed`: Scala 2 constrains sealed-trait
 *  subclasses to the same compilation unit, which would defeat the per-file
 *  refactor. So the compiler checks no `match` over step subtypes for
 *  exhaustiveness: a kind missing from a hand-written match is caught, if at
 *  all, by a registry-driven test or at runtime (see [[PipelineStepKind.All]]
 *  for which tests exist).
```

#### E2 — same file, `trait Companion` scaladoc

OLD:
```
  /** Per-kind registry entry. Each step file exports one of these via its
   *  companion object; the [[Registry]] below assembles them. Adding a new
   *  step kind means defining a new step file with a `Companion` and adding
   *  one line to `Registry` — no edits in the codec, protocol, or engine. */
```
NEW:
```
  /** Per-kind registry entry. Each step file exports one of these via its
   *  companion object; the [[Registry]] below assembles them. A new step kind
   *  needs a step file with a `Companion` and one line in `Registry`, AND the
   *  hand-enumerated codec, protocol, engine, persistence, migration and
   *  frontend sites described on [[PipelineStepKind.All]]. */
```

#### E3 — same file, `val Registry` scaladoc

OLD:
```
  /** Registry of every step kind. Single source of truth — `PipelineStepKind`,
   *  the codec facade, and the protocol union all derive from this Map. */
```
NEW:
```
  /** Registry of every step kind (kind string → [[Companion]]). The source of
   *  truth for [[PipelineStepKind.All]], [[PipelineStepKind.parseKind]] and
   *  [[companionFor]] (which `PipelineStepConfigCodec.decode` / `encode` call).
   *  It is not the only kind list: `PipelineStepConfigCodec.encodeConfig` and
   *  the protocol unions (`PipelineStepProtocol`, `PipelineAnalyzeProtocol`)
   *  match on each kind by hand — see [[PipelineStepKind.All]]. */
```

#### E4 — same file, `object PipelineStepKind` scaladoc

OLD:
```
/** Source of truth for the pipeline step discriminator string. Constants here
 *  are exported by each step file (as `<Kind>Step.Kind`); [[All]] is derived
 *  from the registry so the allow-list cannot drift from the actual set of
 *  registered step kinds. */
```
NEW:
```
/** The pipeline step discriminator strings. Constants here are exported by
 *  each step file (as `<Kind>Step.Kind`); [[All]] is derived from the
 *  registry so this allow-list cannot drift from the registered kinds. It is
 *  not the only list: the sites described on [[All]] enumerate kinds by hand. */
```

#### E5 — same file, `def All` scaladoc

OLD:
```
  /** Registry-derived allow-list. After cycle 3 no consumer enumerates these
   *  manually — adding a new kind only requires updating
   *  [[PipelineStep.Registry]]. */
```
NEW:
```
  /** Registry-derived allow-list: the source of truth for [[parseKind]] and
   *  for the `PipelineStepKind.All.contains` step-type checks in
   *  `PipelineService` and `PipelineProposalService` (these replaced the old
   *  hand-kept `AllowedOps` set). Adding a kind also requires hand-enumerating
   *  further sites, e.g.:
   *   - protocol / codec: `PipelineStepConfigCodec.encodeConfig`,
   *     `PipelineStepProtocol`, `PipelineAnalyzeProtocol`, and
   *     `PipelineService.toAnalyzeStepResponse`;
   *   - engine (apply/infer parity: a kind's `evaluate` in its step file and
   *     its schema inference must read the same config shape):
   *     `StepSchemaInference` and the `*SchemaInference` objects it dispatches
   *     to, `AnalyzeSchemaWarnings`, `StepConfigValidation`,
   *     `PipelineCostEstimator`;
   *   - persistence / services: `PipelineStepRepository`'s row mapping,
   *     `PatchSetPreviewProjectionSteps`, `PipelineStepCatalogService`, and
   *     the type aliases in the `com.helio.domain` package object;
   *   - the `pipeline_steps_op_check` CHECK constraint, via a migration that
   *     drops and re-adds it (latest: V107);
   *   - frontend `features/pipelines`: `types/pipelineStep.ts`,
   *     `state/stepNarrowing.ts`, `hooks/useStepCardState.ts`, the
   *     `ui/StepOpEditor.tsx` dispatch that `StepCard` renders, and a
   *     `ui/stepConfigs/<Op>Config.tsx` component;
   *   - helio-mcp tool descriptions (`src/tools/write.ts`, `src/tools/read.ts`).
   *  That list is a dated snapshot (2026-10-09): re-derive from the tree, e.g.
   *  `git grep -l -i datebucket -- backend/src/main frontend/src helio-mcp/src ':!*.test.*'`
   *  (it lists candidates, including callers such as shapes; it is not a
   *  completeness check). Registry-driven tests catch some missed sites at
   *  test time: `PipelineStepSpec` (pins this set to a literal list),
   *  `PipelineStepRepositorySpec` (inserts and decodes a row of every kind,
   *  so the CHECK constraint and row mapping), `PipelineAnalyzeServiceSpec`
   *  (an `inferOutputSchema` branch per kind), `PipelineCostEstimatorSpec`,
   *  `PipelineStepCatalogServiceSpec`, `PipelineStepSecondSourceGuardSpec`,
   *  and the frontend `stepNarrowing.test.ts` (a `STEP_ICONS` entry per
   *  authorable kind). Re-derive that list with
   *  `git grep -l 'PipelineStep.Registry\|PipelineStepKind.All' -- backend/src/test frontend/src helio-mcp/src`.
   *  A site none of them exercises (e.g. the helio-mcp tool descriptions)
   *  is checked by nothing. */
```

#### E6 — `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala`, object header

OLD:
```
 *  allow-list of step kinds is sourced from [[PipelineStepKind.All]] —
 *  the sealed-trait subclasses are the single source of truth.
```
NEW:
```
 *  allow-list of step kinds is sourced from [[PipelineStepKind.All]], which
 *  derives from [[PipelineStep.Registry]] (the step trait is not sealed). It
 *  is not the only kind list — see [[PipelineStepKind.All]].
```
(Check: if `PipelineStep` is not imported in PipelineService.scala, scaladoc `[[...]]` links are not compiled, so this
is still comment-only; no import is added.)

#### E7 — `backend/src/main/scala/com/helio/domain/panels/PanelConfigCodec.scala`, object header

OLD:
```
/** Dispatcher between the wire-side `(type, config: JsValue)` shape and the
 *  per-subtype typed [[Panel]] / `*Config` / `*Config.Patch` ADTs.
 *
 *  This is the single source of truth for the CS2c-3c wire-shape collapse —
 *  every read (response) and write (create / update / batch) routes through
 *  one of these methods so the seven-subtype enumeration is centralised in
 *  one file. */
```
NEW:
```
/** Dispatcher between the wire-side `(type, config: JsValue)` shape and the
 *  per-subtype typed [[Panel]] / `*Config` / `*Config.Patch` ADTs:
 *  `encodeConfig` (responses), `decodeCreateConfig` (create paths, e.g.
 *  panel create and dashboard snapshot import) and `applyConfigPatch`
 *  (config-patch paths).
 *
 *  Each of these matches on every panel kind by hand, and this file is not
 *  the only place that does: `PanelServiceHelpers` and
 *  `DashboardSnapshotRepository` match on every one of this object's
 *  `*Create` results, and `PanelRowMapper` maps `panels.kind` to a subtype
 *  itself. See
 *  `PanelKind.All` (Panel.scala) for the wider drift surface and a re-derive
 *  command. */
```

#### E8 — `backend/src/test/scala/com/helio/domain/model/PanelSpec.scala`

OLD: `    "be the single source of truth for all 6 panel kinds" in {`
NEW: `    "have exactly the 6 panel kinds as its key set" in {`

#### E9 — new file `scripts/lib/panelKindEnumCoverage.mjs` (verbatim)

```js
// HEL-1412 / HEL-1149: coverage check for the panel-kind enum parity guard in
// scripts/check-schema-drift.mjs. That guard only compares the enums it is told about
// (panelTypeSurfaces), so a schema carrying a panel-kind enum could sit outside it unnoticed
// (create-panels-batch-request.schema.json did). These pure helpers find every panel-kind enum
// under schemas/ and require each to be a checked surface or an explicit, reasoned exemption.

/** An `enum` array counts as a panel-kind enum when it holds at least this many canonical panel
 *  kinds. Measured 2026-10-09: panel-kind enums hold 5-6, every other schema enum at most 1. */
export const PANEL_KIND_ENUM_MIN_HITS = 2;

/** Panel-kind enums deliberately NOT parity-checked. Key: enumKey(file, path); value: the reason.
 *  Empty: every detected panel-kind enum is a checked surface. */
export const PANEL_KIND_ENUM_EXEMPTIONS = {};

/** `<path under schemas/>#<dot-joined JSON path to the enum array>`. */
export function enumKey(file, path) {
  return `${file}#${path.join(".")}`;
}

/** JSON paths (arrays of keys ending in "enum") of every enum array in `schema` holding at least
 *  `minHits` of `canonicalKinds`. */
export function findPanelKindEnums(schema, canonicalKinds, minHits = PANEL_KIND_ENUM_MIN_HITS) {
  const kinds = new Set(canonicalKinds);
  const found = [];
  function visit(node, path) {
    if (Array.isArray(node)) {
      node.forEach((child, i) => visit(child, [...path, String(i)]));
      return;
    }
    if (node === null || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (key === "enum" && Array.isArray(value)) {
        if (value.filter((v) => kinds.has(v)).length >= minHits) found.push([...path, key]);
      } else {
        visit(value, [...path, key]);
      }
    }
  }
  visit(schema, []);
  return found;
}

/** detected / covered: arrays of { file, path }; exemptions: { [enumKey]: reason }.
 *  Returns error strings (empty when every detected enum is checked or exempted). */
export function validatePanelKindEnumCoverage({ detected, covered, exemptions }) {
  const errors = [];
  const coveredKeys = new Set(covered.map(({ file, path }) => enumKey(file, path)));
  const detectedKeys = new Set(detected.map(({ file, path }) => enumKey(file, path)));
  for (const key of detectedKeys) {
    if (!coveredKeys.has(key) && !(key in exemptions)) {
      errors.push(
        `panel-kind enum coverage: schemas/${key} holds a panel-kind enum but is neither a ` +
          "checked surface (panelTypeSurfaces in scripts/check-schema-drift.mjs) nor exempted " +
          "(PANEL_KIND_ENUM_EXEMPTIONS in scripts/lib/panelKindEnumCoverage.mjs)",
      );
    }
  }
  for (const [key, reason] of Object.entries(exemptions)) {
    if (typeof reason !== "string" || reason.trim() === "") {
      errors.push(`panel-kind enum coverage: exemption ${key} has no stated reason`);
    }
    if (!detectedKeys.has(key)) {
      errors.push(`panel-kind enum coverage: exemption ${key} is stale (no panel-kind enum there)`);
    }
    if (coveredKeys.has(key)) {
      errors.push(
        `panel-kind enum coverage: ${key} is both a checked surface and exempted; remove the exemption`,
      );
    }
  }
  return errors;
}
```

#### E10 — `scripts/check-schema-drift.mjs`

E10a — import. OLD:
```
} from "./lib/agentFacingPanelTypes.mjs";
```
NEW:
```
} from "./lib/agentFacingPanelTypes.mjs";
import {
  PANEL_KIND_ENUM_EXEMPTIONS,
  findPanelKindEnums,
  validatePanelKindEnumCoverage,
} from "./lib/panelKindEnumCoverage.mjs";
```

E10b — surfaces. OLD: the whole block from the line `const panelTypeSurfaces = [` through its closing `];` (the
array with the four `getEnumAt(...)` entries: create-panel-request, panel, update-panels-batch-request,
dashboard-proposal), i.e. everything between `const bindingFieldByKind = {...};` and the blank line before
`const helioMcpProposalSrc = readFileSync(helioMcpProposalTs, "utf8");`. NEW:
```js
// HEL-1412: each schemas/ surface records schemaFile + enumPath so the panel-kind enum coverage
// check below knows which schema enums are parity-checked here.
function schemaEnumSurface(schemaFile, enumPath, canonical) {
  return {
    label: `schemas/${schemaFile} ${enumPath.join(".")}`,
    canonical,
    schemaFile,
    enumPath,
    actual: getEnumAt(
      JSON.parse(readFileSync(join(schemasDir, schemaFile), "utf8")),
      enumPath,
      schemaFile,
    ),
  };
}

const panelTypeSurfaces = [
  schemaEnumSurface(
    "panels/create-panel-request.schema.json",
    ["properties", "type", "enum"],
    canonicalPanelTypes,
  ),
  schemaEnumSurface(
    "panels/panel.schema.json",
    ["properties", "type", "enum"],
    canonicalPanelTypes,
  ),
  schemaEnumSurface(
    "panels/update-panels-batch-request.schema.json",
    ["properties", "panels", "items", "properties", "type", "enum"],
    canonicalPanelTypes,
  ),
  // HEL-1412 / HEL-1149: this enum sat outside every checked surface; HEL-1083 found it by hand.
  schemaEnumSurface(
    "panels/create-panels-batch-request.schema.json",
    ["properties", "panels", "items", "properties", "type", "enum"],
    canonicalPanelTypes,
  ),
  schemaEnumSurface(
    "dashboards/dashboard-proposal.schema.json",
    ["$defs", "ProposalPanel", "properties", "type", "enum"],
    agentFacingPanelTypes,
  ),
];
```

E10c — coverage check. Insert immediately AFTER the parity loop that ends with
```
  else panelTypeChecked += 1;
}
```
(the loop `for (const { label, canonical, actual } of [...panelTypeSurfaces, ...dataPanelTypeSurfaces]) {`) this block:
```js

// --- Panel-kind enum coverage (HEL-1412 / HEL-1149) ---
// The parity loop above only sees the enums listed in panelTypeSurfaces. Find every enum under
// schemas/ that holds panel kinds and require each to be a checked surface or an explicit,
// reasoned exemption (scripts/lib/panelKindEnumCoverage.mjs), so the list cannot silently miss one.
const detectedPanelKindEnums = allDiscoveredFiles
  .filter((file) => file.endsWith(".json"))
  .flatMap((file) =>
    findPanelKindEnums(
      JSON.parse(readFileSync(join(schemasDir, file), "utf8")),
      canonicalPanelTypes,
    ).map((path) => ({ file, path })),
  );
errors.push(
  ...validatePanelKindEnumCoverage({
    detected: detectedPanelKindEnums,
    covered: panelTypeSurfaces
      .filter((s) => s.schemaFile)
      .map((s) => ({ file: s.schemaFile, path: s.enumPath })),
    exemptions: PANEL_KIND_ENUM_EXEMPTIONS,
  }),
);
```

E10d — summary line. OLD:
```
console.log(
  `panel-type enums in sync with backend canonical sets (${panelTypeChecked} surfaces checked)`,
);
```
NEW:
```
console.log(
  `panel-type enums in sync with backend canonical sets (${panelTypeChecked} surfaces checked)`,
);
console.log(
  `panel-kind enum coverage: ${detectedPanelKindEnums.length} schema enums detected, each checked or exempted`,
);
```

#### E11 — `scripts/check-schema-drift.selftest.mjs`

E11a — import. OLD:
```
} from "./lib/agentFacingPanelTypes.mjs";
```
NEW:
```
} from "./lib/agentFacingPanelTypes.mjs";
import {
  PANEL_KIND_ENUM_EXEMPTIONS,
  findPanelKindEnums,
  validatePanelKindEnumCoverage,
} from "./lib/panelKindEnumCoverage.mjs";
```

E11b — insert immediately BEFORE the line
`check("the real script passes against the repository with form on the agent surfaces", () => {`:
```js
// HEL-1412 / HEL-1149: the panel-kind enum coverage check must stay failable.
check("findPanelKindEnums finds a nested panel-kind enum and ignores a one-kind enum", () => {
  const schema = {
    properties: {
      panels: { items: { properties: { type: { enum: ["text", "markdown", "output"] } } } },
      control: { enum: ["text", "dropdown"] },
    },
  };
  const found = findPanelKindEnums(schema, canonical).map((p) => p.join("."));
  assert(
    JSON.stringify(found) === JSON.stringify(["properties.panels.items.properties.type.enum"]),
    JSON.stringify(found),
  );
});

check("an unchecked, unexempted panel-kind enum fails, naming file and path", () => {
  const errors = validatePanelKindEnumCoverage({
    detected: [{ file: "panels/new.schema.json", path: ["properties", "type", "enum"] }],
    covered: [],
    exemptions: {},
  });
  assert(
    errors.length === 1 && errors[0].includes("panels/new.schema.json#properties.type.enum"),
    errors.join("; "),
  );
});

check("a checked enum and a reason-exempted enum both pass", () => {
  const detected = [
    { file: "a.schema.json", path: ["properties", "type", "enum"] },
    { file: "b.schema.json", path: ["properties", "type", "enum"] },
  ];
  const errors = validatePanelKindEnumCoverage({
    detected,
    covered: [detected[0]],
    exemptions: { "b.schema.json#properties.type.enum": "a stated reason for the exemption" },
  });
  assert(errors.length === 0, errors.join("; "));
});

check("a reasonless, a stale, and a checked-and-exempted exemption each fail", () => {
  const detected = [{ file: "a.schema.json", path: ["properties", "type", "enum"] }];
  const key = "a.schema.json#properties.type.enum";
  const noReason = validatePanelKindEnumCoverage({
    detected,
    covered: [],
    exemptions: { [key]: "  " },
  });
  assert(includesText(noReason, "no stated reason"), noReason.join("; "));
  const stale = validatePanelKindEnumCoverage({
    detected: [],
    covered: [],
    exemptions: { "gone.schema.json#properties.type.enum": "was here once" },
  });
  assert(includesText(stale, "stale"), stale.join("; "));
  const both = validatePanelKindEnumCoverage({
    detected,
    covered: detected,
    exemptions: { [key]: "duplicate" },
  });
  assert(includesText(both, "both a checked surface and exempted"), both.join("; "));
});

check("the real exemption table gives every entry a reason", () => {
  for (const [key, reason] of Object.entries(PANEL_KIND_ENUM_EXEMPTIONS)) {
    assert(typeof reason === "string" && reason.trim().length > 0, `${key} has no reason`);
  }
});

```

## Claim → proof (run from the worktree root; paste command + real output)

| # | Claim (where) | Command | Expected |
|---|---|---|---|
| P1 | no `AllowedOps` left in main code (E5) | `git grep -n -i allowedops -- backend/src/main/scala ':!backend/src/main/scala/com/helio/domain/model/PipelineStep.scala'` (excludes E5's own mention of the old set) | no output |
| P2 | `All.contains` checks live in PipelineService + PipelineProposalService (E5) | `git grep -n 'PipelineStepKind.All.contains' -- backend/src/main/scala` | hits only in `PipelineService.scala` (code lines) and `PipelineProposalService.scala`, plus a comment in `UpsertSourceConfig.scala`, plus (after the edit) E5's own mention in `PipelineStep.scala` |
| P3 | AllowedOps once existed (E5 "replaced the old") | `git grep -n 'AllowedOps' -- backend/src/test backend/src/main/resources/db/migration` | hits in `PipelineStepRoutesSpec.scala` and `V31__add_aggregate_op.sql` |
| P4 | registry feeds All/parseKind/companionFor; decode/encode call companionFor (E3) | `grep -n 'Registry\|companionFor' backend/src/main/scala/com/helio/domain/model/PipelineStep.scala backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineStepConfigCodec.scala` | `def All ... Registry.keySet`; `parseKind` uses `All`; `companionFor` uses `Registry.get`; codec `decode`/`encode` call `PipelineStep.companionFor` |
| P5 | encodeConfig + protocol unions match per kind (E3, E5) | `grep -c 'case c: ' backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineStepConfigCodec.scala; grep -c 'PipelineStepKind\.' backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineStepProtocol.scala backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineAnalyzeProtocol.scala` | each ≥ 20 |
| P6 | the layer list in E5 (every named file) | `git grep -l -i datebucket -- backend/src/main frontend/src helio-mcp/src ':!*.test.*'` | output includes PipelineStepConfigCodec, PipelineStepProtocol, PipelineAnalyzeProtocol, StepSchemaInference, ReshapeSchemaInference, ColumnSchemaInference, MultiInputSchemaInference, AnalyzeSchemaWarnings, PipelineCostEstimator, PipelineStepRepository, PatchSetPreviewProjectionSteps, PipelineService, PipelineStepCatalogService, domain/package.scala, V107, pipelineStep.ts, stepNarrowing.ts, useStepCardState.ts, StepOpEditor.tsx, DateBucketConfig.tsx, helio-mcp write.ts and read.ts, plus shapes/TimeSeriesShape.scala and firstrun/ColumnClassifier.scala (the "callers such as shapes"); it may also list files that only mention the op in a comment (e.g. `frontend/src/features/panels/provenance/provenanceLabels.ts`) — extra files are NOT a mismatch; only a MISSING named file is |
| P7 | StepConfigValidation enumerates kinds (E5) | `grep -n 'Step.Kind *=>' backend/src/main/scala/com/helio/domain/engine/StepConfigValidation.scala` | ≥ 3 lines |
| P8 | StepSchemaInference dispatches to `*SchemaInference` objects (E5) | `grep -n '^import .*SchemaInference' backend/src/main/scala/com/helio/domain/engine/StepSchemaInference.scala` | 4 imports: Column/MultiInput/Reshape/Text |
| P9 | `toAnalyzeStepResponse` maps per kind (E5) | `grep -n 'def toAnalyzeStepResponse' backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala; grep -c 'AnalyzeStepResponse(s.id' backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` | 1 def; count ≥ 20 |
| P10 | `pipeline_steps_op_check` last redefined in V107 (E5) | `git grep -l pipeline_steps_op_check -- backend/src/main/resources/db/migration \| sort -V \| tail -1` | `.../V107__add_writeback_ops.sql` |
| P11 | StepCard renders StepOpEditor (E5) | `grep -n 'StepOpEditor' frontend/src/features/pipelines/ui/StepCard.tsx` | import + usage |
| P12 | `PipelineStepSpec` pins All to a literal list (E5) | `grep -n -A2 'define a constant for every subtype' backend/src/test/scala/com/helio/domain/model/PipelineStepSpec.scala` | `PipelineStepKind.All shouldBe Set(` + string literals |
| P13 | trait not sealed; Scala 2 (E1, E6) | `grep -n '^trait PipelineStep\|^sealed' backend/src/main/scala/com/helio/domain/model/PipelineStep.scala; grep -n scalaVersion backend/build.sbt` | `trait PipelineStep {` (no `sealed`); `2.13.x` |
| P14 | step file holds config + evaluate + codec (E1) | `grep -n 'final case class DateBucketConfig\|def evaluate\|def decode\|val companion' backend/src/main/scala/com/helio/domain/steps/DateBucketStep.scala` | all four present |
| P15 | PanelConfigCodec's three methods each match every kind (E7) | `grep -n 'def encodeConfig\|def decodeCreateConfig\|def applyConfigPatch\|case .*\(Text\|Markdown\|Image\|Divider\|Output\|Form\)' backend/src/main/scala/com/helio/domain/panels/PanelConfigCodec.scala` | 3 defs, 6 kind arms under each |
| P16 | callers by path (E7) | `git grep -n 'PanelConfigCodec\.\(encodeConfig\|decodeCreateConfig\|applyConfigPatch\)(' -- backend/src/main` | encodeConfig: PanelProtocol, DashboardProtocol; decodeCreateConfig incl. PanelServiceHelpers, DashboardSnapshotRepository, DashboardServiceValidation, DashboardSnapshotImport; applyConfigPatch incl. PanelMutationRepository, PanelPatchApplier, PanelBindingChecks, BatchControlsCheck (PatchSetApplyRollback / PatchSetPreviewProjection also call one of the three) |
| P17 | PanelServiceHelpers + DashboardSnapshotRepository match EVERY `*Create`; PanelRowMapper maps kind (E7) | `git grep -c 'case PanelConfigCodec\.\(Text\|Markdown\|Image\|Divider\|Output\|Form\)Create' -- backend/src/main; git grep -n 'case FormPanel.Kind' -- backend/src/main` | first command: `PanelServiceHelpers.scala` ≥6 (8 at c91fffaf6), `DashboardSnapshotRepository.scala:6`, and `PatchSetApplyResolvers.scala:2` (FormCreate only, not a per-kind match — hence not named in E7); second: PanelRowMapper and PanelConfigCodec |
| P18 | 6 panel kinds (E7, E8) | `grep -n -A7 '"Panel.Registry" should' backend/src/test/scala/com/helio/domain/model/PanelSpec.scala` | 6 `*.Kind` entries |
| P19 | `PanelKind.All` in Panel.scala carries a re-derive command (E7) | `grep -n 'git grep -l -i divider' backend/src/main/scala/com/helio/domain/model/Panel.scala` | 1 line |
| P20 | threshold measurement (D2) | `node -e 'const fs=require("fs"),p=require("path");const K=["output","text","markdown","image","divider","form"];const w=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?w(p.join(d,e.name)):e.name.endsWith(".json")?[p.join(d,e.name)]:[]);for(const f of w("schemas")){(function r(n,q){if(Array.isArray(n))return n.forEach((x,i)=>r(x,q+"."+i));if(n&&typeof n==="object")for(const[k,v]of Object.entries(n)){if(k==="enum"&&Array.isArray(v)){const h=v.filter(x=>K.includes(x)).length;if(h)console.log(h,f,q)}else r(v,q+"."+k)}})(JSON.parse(fs.readFileSync(f,"utf8")),"")}'` | five lines with 5 or 6; all others 1 |
| P22 | registry-driven test inventory (E5 tail) | `git grep -l 'PipelineStep.Registry\|PipelineStepKind.All' -- backend/src/test frontend/src helio-mcp/src; grep -n 'insertRawStep\|shouldBe PipelineStepKind.All' backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepositorySpec.scala; grep -n 'every kind in PipelineStep.Registry has an inferOutputSchema branch' backend/src/test/scala/com/helio/domain/engine/PipelineAnalyzeServiceSpec.scala; grep -n 'STEP_ICONS has an entry for every authorable' frontend/src/features/pipelines/state/stepNarrowing.test.ts` | file list includes PipelineStepSpec, PipelineStepRepositorySpec, PipelineAnalyzeServiceSpec, PipelineCostEstimatorSpec, PipelineStepCatalogServiceSpec, PipelineStepSecondSourceGuardSpec, stepNarrowing.test.ts, and NO helio-mcp file; the three greps each print ≥1 line |
| P21 | nothing matches on old surface labels (D3) | `git grep -n 'panels.items.type.enum' -- scripts frontend helio-mcp .github` | only the removed line in check-schema-drift.mjs before the edit / nothing after |

## Red-first evidence for the guard (tasks.md §1 and §4)

- R1 (on the untouched base, before any edit): drop `"form"` from the batch-create enum; `node scripts/check-schema-drift.mjs` exits **0** (gap proven). Restore.
- R1b (base): add a fake `case "fake" => Right(Form)` arm to `PanelType.fromString`; the script fails, but its output contains **no** `create-panels-batch-request` (batch enum unobserved). Restore.
- R2 (after edits): R1's mutation → exit **1**, output names `create-panels-batch-request.schema.json` and `missing: form`. Restore.
- R3 (after edits): R1b's mutation → exit 1, output includes `create-panels-batch-request.schema.json` with `missing: fake`. Restore.
- R4 (after edits): create `schemas/panels/hel1412-mutant.json` holding `{"enum":["text","output"]}` → exit 1 naming `schemas/panels/hel1412-mutant.json#enum`. Delete exactly that file.

## Risks / Trade-offs

- A future non-panel enum that happens to hold two panel-kind strings (e.g. `["text","markdown"]` in some content
  format) is flagged; the remedy is an explicit exemption with a reason — intended friction, not a false gate.
- The threshold is a heuristic; the "measured" numbers are dated in the module comment.
- `.json` files under `schemas/` are all parsed now; a non-JSON `.json` would throw loudly (none today — P20 parses all).

## Follow-ups (not in scope; file as tickets)

1. `PipelineStepSpec`'s "pattern-match coverage — sealed-trait dispatch is exhaustive" comment says "adding an 11th
   subtype ... fails compilation (sealed-trait exhaustiveness)" — the trait is not sealed (P13).
2. `PipelineStepConfigCodec.scala` ~:75-82 says `upsertsource` "is deliberately NOT in `PipelineStep.Registry` yet" —
   it is registered now.
3. `domain/steps/README.md` lists 23 step files / "23 step kinds"; 27 are registered.
4. `PipelineShape.scala:39` makes the same "Single source of truth" registry claim for shapes.
5. `PipelineStepSecondSourceGuardSpec.scala:17` calls `PipelineStep.Registry` "the single source of truth" (test comment).
