## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: `c91fffaf6ac92cfb0b21c69b0c96d97c4c851d9e` (worktree HEAD; only the untracked change dir on top).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/correct-registry-overclaims-drift/HEL-1412`.

### What I verified (with evidence)

**Item 4 / E9–E11 (drift-check), executed in a scratch copy** (`git archive HEAD` of scripts, schemas, backend/src/main, helio-mcp/src, frontend/src/features/dashboards). E9/E10b/E10c/E11b were extracted verbatim from design.md by line range, and E10a/E10d/E11a were applied by exact-once string replacement. Every OLD/anchor matched exactly once.
- Baseline (unedited): exit 0, `8 surfaces checked`.
- R1 on the base (drop `"form"` from the batch enum): the grep shows the enum without form, then **exit=0**. The gap is real.
- R1b on the base (perl adds `case "fake"`): exactly one `case "fake"` line (model.scala:157), exit=1, and `grep -c create-panels-batch-request` = **0**. The batch enum is not observed.
- After the edits: `node scripts/check-schema-drift.mjs` gives exit 0, `(9 surfaces checked)` and `panel-kind enum coverage: 5 schema enums detected, each checked or exempted`. Both expected strings in tasks 3.1 are correct.
- Selftest: all 15 cases `ok`, exit 0.
- R2: exit 1, `schemas/panels/create-panels-batch-request.schema.json properties.panels.items.properties.type.enum:` / `missing: form`.
- R3: exit 1, grep count 1, the same surface shows `missing: fake`.
- R4: exit 1, `panel-kind enum coverage: schemas/panels/hel1412-mutant.json#enum holds a panel-kind enum but is neither ...`. The first loop skips non-`.schema.json` files, so this error is the only one.
- An extra mutation (removing the batch-create `schemaEnumSurface` entry) makes the coverage check name `schemas/panels/create-panels-batch-request.schema.json#properties.panels.items.properties.type.enum`, exit 1. This proves the derived coverage catches the HEL-1149 class directly.
- Selftest failability: making `validatePanelKindEnumCoverage` return `[]` fails 2 of the new cases. `PANEL_KIND_ENUM_MIN_HITS = 1` fails the `findPanelKindEnums` case and the real-script case. The new cases are not vacuous.
- P20 reproduced: four enums with 6 hits (create-panel, panel, update-batch, create-batch), dashboard-proposal with 5, and every other enum with 1. The threshold of 2 is sound. `allDiscoveredFiles` holds paths relative to `schemas/`, which matches `schemaFile` exactly. `find schemas -name '*.json' ! -name '*.schema.json'` returns nothing.
- Prettier 3.8.1 with the repo config re-wraps exactly one E10b line (the `panels/panel.schema.json` call, 101 chars). This is whitespace only, and task 2.8 handles it. `npx --no-install prettier` resolves from the worktree through the ancestor node_modules.
- HEL-1149 (fetched) AC1–AC4: AC1 is met by the new surface and R2. AC2 is met by the R1b→R3 mutation pair. AC3 is met by `PANEL_KIND_ENUM_EXEMPTIONS` with a reason and its hygiene checks. AC4 is met by the coverage derived from a scan of `schemas/`. Item 4 fully covers HEL-1149, so it can be closed by reference.

**Items 1–3 (Scala comment text)**
- Every E1–E7 OLD block occurs exactly once in its file, and E8 occurs once (node exact-substring count).
- Positive control for task 4.2: `git show HEAD:...PipelineStep.scala | grep -c -i -E '...'` gives **6**, which is correct. The after-edit regexes do not hit the out-of-scope `configValue` "single source of truth" at PipelineStep.scala:90.
- P1 returns nothing. P2 hits PipelineService (547/1625/1858), PipelineProposalService:286 and a comment in UpsertSourceConfig. P3 hits V31 and PipelineStepRoutesSpec. P4: `companionFor` is backed by `Registry.get`, `parseKind` by `All`, and codec decode/encode call `companionFor`. P5 gives 27 / 54 / 54. P6 matches its expected list, plus `provenanceLabels.ts` (a comment false positive). P7–P14, P16, P18 and P19 all match their expectations. P10 gives V107. P13: `trait PipelineStep {`, Scala 2.13.15.
- `openspec validate registry-overclaims-and-batch-drift --type change` reports the change as valid.

**Factual audit of the NEW comment text: two sentences are false or misleading (see Change Requests).**
- E5 ends with: "Known gate: `PipelineStepSpec` pins this set to a literal list of kinds; it does not detect a missed hand-enumerated site." It is offered as the gate inventory, and it omits registry-driven guard specs that **do** detect missed hand-enumerated sites. Evidence from `git grep -n 'Registry\.\(keys\|keySet\|foreach\|...\)\|PipelineStepKind.All\b' -- backend/src/test`:
  - `PipelineStepRepositorySpec.scala:102-111`: "decode rows for every step kind persisted with config='{}'". It raw-INSERTs every `PipelineStepKind.All` kind, which fails on a value missing from `pipeline_steps_op_check`. It then decodes through `listByPipeline`, which fails on a missing `PipelineStepRepository` row-mapping arm (e.g. :1334).
  - `PipelineAnalyzeServiceSpec.scala:1468-1545`: the "inferOutputSchema coverage guard". Every `PipelineStep.Registry` kind needs a probe and a reachable inference branch, which catches a missing `StepSchemaInference` branch.
  - `PipelineCostEstimatorSpec.scala:131-150`: partitions every registered op into CheapOps/AiOps/WriteBackOps/ContentConversionOps, which catches a missed `PipelineCostEstimator` classification.
  - `PipelineStepSecondSourceGuardSpec.scala:40` and `PipelineStepCatalogServiceSpec.scala:17` are also Registry-driven.

  The HEL-1156 precedent (Panel.scala `PanelKind.All`) names the gates that fire **and** the sites that fall through. E5 as written tells the reader that nothing catches a missed site. That is false, and no P-command backs it, which violates AC5 and constraint C2. In a ticket that exists to correct inaccurate completeness claims, this is a blocking defect.
- E1's "a kind missing from a hand-written match surfaces at runtime, if at all, not at compile time" has the same omission in milder form: several sites are caught at test time by the specs above. `PipelineStepConfigCodec.scala:107-110` already says so ("caught at test time, not by the compiler").
- E7's sentence "Each of these matches on every panel kind by hand, and this file is not the only place that does: `PanelServiceHelpers`, `DashboardSnapshotRepository` and `PatchSetApplyResolvers` match on this object's `*Create` results" is wrong about `PatchSetApplyResolvers`. At `PatchSetApplyResolvers.scala:323-335` it matches only `FormCreate` (two guarded arms) with a `case _ =>` fallthrough. It is not a per-kind enumeration. P17's grep (FormCreate only) cannot distinguish the two cases, so the P-command does not back the claim.

### Verdict: REFUTE

### Change Requests

1. **design.md E5 (PipelineStepKind.All scaladoc), final "Known gate" sentence.** Replace it with an accurate gate inventory in the HEL-1156 shape: "Known gates: …; sites with no gate: …". At minimum, name `PipelineStepRepositorySpec` (persists and decodes every kind, which covers the CHECK constraint and row mapping), the `PipelineAnalyzeServiceSpec` inferOutputSchema coverage guard (schema inference), and the `PipelineCostEstimatorSpec` op partition (cost estimator). Keep `PipelineStepSpec` (literal kind list). Say that the remaining named sites (e.g. the protocol unions, `encodeConfig`, the frontend and the helio-mcp descriptions) have no registry-driven guard. Verify every gate or no-gate assignment you write before pinning it.
2. **Add a P-command (P22) that backs the gate inventory in CR1**, for example `git grep -n 'PipelineStep.Registry\.\(keySet\|foreach\|values\)\|PipelineStepKind.All\.\(foreach\|toSeq\)' -- backend/src/test`, with the expected hits listed. Add it to tasks.md 4.1.
3. **design.md E1, second paragraph.** Change "surfaces at runtime, if at all, not at compile time" so it no longer excludes test-time detection, e.g. "surfaces at test time (where a registry-driven guard spec covers that site — see [[PipelineStepKind.All]]) or at runtime, if at all, never at compile time".
4. **design.md E7.** Stop listing `PatchSetApplyResolvers` as a site that "matches on every panel kind". Either drop it, or state that it matches `FormCreate` specifically (with a `case _` fallthrough). Update P17's expectation so the proof distinguishes full per-kind matches (PanelServiceHelpers:~144, DashboardSnapshotRepository:~184, PanelRowMapper) from the single-kind match. For example, grep `case PanelConfigCodec\.\(Text\|Markdown\|Image\|Divider\|Output\|Form\)Create` and expect 6 arms each in PanelServiceHelpers and DashboardSnapshotRepository.

### Non-blocking notes

- E10b: you could pin the `panels/panel.schema.json` `schemaEnumSurface(...)` call pre-wrapped over 4 lines (its one-line form is 101 chars). Prettier re-wraps it at 2.8 anyway, but pre-wrapping makes the "verbatim" diff exact for a Haiku executor.
- `backend/src/main/scala/com/helio/domain/shapes/PipelineShape.scala:39` makes the same "Registry … Single source of truth" claim for shapes. Consider adding it to the follow-up list.
- Task 5.1 uses `testOnly`. CLAUDE.md warns that sbt 2 caches `test`. The "renamed test name appears in the output" expectation already detects a zero-test cached run, so keep that check.
- P6's real output also includes `frontend/src/features/panels/provenance/provenanceLabels.ts` (a comment example, not a site). The "includes" wording tolerates it, but noting it avoids a Haiku STOP.
- Item 4 is sound as pinned and covers HEL-1149 AC1–AC4 completely. No change is needed there.
