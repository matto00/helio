# Files modified: registry-overclaims-and-batch-drift (HEL-1412)

## Files

- `backend/src/main/scala/com/helio/domain/model/PipelineStep.scala` — comment-only: header, Companion, Registry, PipelineStepKind, All scaladoc rewritten to name hand-enumerated layers (E1–E5)
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — comment-only: object header (E6)
- `backend/src/main/scala/com/helio/domain/panels/PanelConfigCodec.scala` — comment-only: object header (E7)
- `backend/src/test/scala/com/helio/domain/model/PanelSpec.scala` — test name only (E8)
- `scripts/check-schema-drift.mjs` — panel-kind enum coverage: schemaEnumSurface helper, create-panels-batch-request surface added, coverage check and summary line (E10a–d)
- `scripts/check-schema-drift.selftest.mjs` — five HEL-1412 cases (E11a–b)
- `scripts/lib/panelKindEnumCoverage.mjs` — new pure helper module (E9)
- `openspec/changes/registry-overclaims-and-batch-drift/` — change artifacts and this file

## Note on amended claim proofs

P1 and P2 in design.md were amended by the orchestrator after the executor's stop report (agent ad74d1315ac7200f2 relayed the amendment). The original P1 expectation (no `AllowedOps` anywhere in backend/src/main/scala) was contradicted by the pinned E5 text, which itself says "these replaced the old hand-kept `AllowedOps` set". P1 now excludes PipelineStep.scala; P2 now expects E5's self-mention in PipelineStep.scala. E5 text was not changed. Amended commands are re-run below.

## Red-first evidence

Run on the untouched base, before any edit.

R1 (1.1): drop `"form"` from the create-panels-batch enum, then run the drift script.
```
27:            "enum": ["text", "markdown", "image", "divider", "output"]
check-schema-drift: raw recursive walk found 150 entries under .../HEL-1412/schemas
schemas in sync with JsonProtocols (122 checked across 54 protocol files)
panel-type enums in sync with backend canonical sets (8 surfaces checked)
AssistantProposalToolSchemas.scala in sync with schemas/ (14 surfaces checked)
exit=0
```

R1b (1.2): add `case "fake" => Right(Form)` to PanelType.fromString.
```
157:    case "fake"     => Right(Form)
exit=1
0
(output lists create-panel-request, panel, update-panels-batch-request, dashboard-proposal and helio-mcp PANEL_TYPES with "missing: fake"; no create-panels-batch-request line)
```

1.3: `git status --short` showed only `?? openspec/changes/registry-overclaims-and-batch-drift/` after restoring both mutations.

R2 (3.3, after edits): same mutation as R1.
```
schemas/panels/create-panels-batch-request.schema.json properties.panels.items.properties.type.enum:
  missing: form
exit=1
```

R3 (3.4, after edits): same mutation as R1b.
```
157:    case "fake"     => Right(Form)
exit=1
1
schemas/panels/create-panels-batch-request.schema.json properties.panels.items.properties.type.enum:
  missing: fake
(plus the other five surfaces with "missing: fake")
```

R4 (3.5, after edits): mutant file `schemas/panels/hel1412-mutant.json` holding `{"enum": ["text", "output"]}`, then deleted.
```
panel-kind enum coverage: schemas/panels/hel1412-mutant.json#enum holds a panel-kind enum but is neither a checked surface (panelTypeSurfaces in scripts/check-schema-drift.mjs) nor exempted (PANEL_KIND_ENUM_EXEMPTIONS in scripts/lib/panelKindEnumCoverage.mjs)
exit=1
```

## Claim proofs

Run from the worktree root after the edits.

P1 (amended): `git grep -n -i allowedops -- backend/src/main/scala ':!backend/src/main/scala/com/helio/domain/model/PipelineStep.scala'` → no output, exit=1. Match.

P2 (amended): `git grep -n 'PipelineStepKind.All.contains' -- backend/src/main/scala` → PipelineStep.scala:331 (E5 self-mention, expected after amendment), UpsertSourceConfig.scala:16, PipelineProposalService.scala:286, PipelineService.scala:548, :1621, :1626, :1859. Match.

P3: `git grep -n 'AllowedOps' -- backend/src/test backend/src/main/resources/db/migration` → PipelineStepRoutesSpec.scala (lines 971–1024) and V31__add_aggregate_op.sql:4. Match.

P4: `grep -n 'Registry\|companionFor' .../PipelineStep.scala .../PipelineStepConfigCodec.scala` → `def All: Set[String] = PipelineStep.Registry.keySet` (line 367); `companionFor` uses `Registry.get` (line 288); codec `decode`/`encode` call `PipelineStep.companionFor` (lines 31, 41). Match.

P5: `grep -c 'case c: ' PipelineStepConfigCodec.scala` → 27; `grep -c 'PipelineStepKind\.' PipelineStepProtocol.scala PipelineAnalyzeProtocol.scala` → 54, 54. All ≥ 20. Match.

P6: `git grep -l -i datebucket -- backend/src/main frontend/src helio-mcp/src ':!*.test.*'` → 39 files, including every named file (PipelineStepConfigCodec, PipelineStepProtocol, PipelineAnalyzeProtocol, StepSchemaInference, ReshapeSchemaInference, ColumnSchemaInference, MultiInputSchemaInference, AnalyzeSchemaWarnings, PipelineCostEstimator, PipelineStepRepository, PatchSetPreviewProjectionSteps, PipelineService, PipelineStepCatalogService, domain/package.scala, V107__add_writeback_ops.sql, pipelineStep.ts, stepNarrowing.ts, useStepCardState.ts, StepOpEditor.tsx, DateBucketConfig.tsx, helio-mcp read.ts and write.ts, TimeSeriesShape.scala, ColumnClassifier.scala). Extra files are not a mismatch. Match.

P7: `grep -n 'Step.Kind *=>' StepConfigValidation.scala` → 8 lines (≥ 3). Match.

P8: `grep -n '^import .*SchemaInference' StepSchemaInference.scala` → 4 imports (Column, MultiInput, Reshape, Text). Match.

P9: `grep -n 'def toAnalyzeStepResponse' PipelineService.scala` → 1 def at line 1748; `grep -c 'AnalyzeStepResponse(s.id'` → 27. Match.

P10: `git grep -l pipeline_steps_op_check -- backend/src/main/resources/db/migration | sort -V | tail -1` → `backend/src/main/resources/db/migration/V107__add_writeback_ops.sql`. Match.

P11: `grep -n 'StepOpEditor' frontend/src/features/pipelines/ui/StepCard.tsx` → import at line 15, usage `<StepOpEditor` at line 440. Match.

P12: `grep -n -A2 'define a constant for every subtype' PipelineStepSpec.scala` → `PipelineStepKind.All shouldBe Set(` with string literals. Match.

P13: `grep -n '^trait PipelineStep\|^sealed' PipelineStep.scala` → `39:trait PipelineStep {`, no sealed; `build.sbt` → `scalaVersion := "2.13.15"`. Match.

P14: `grep -n ... DateBucketStep.scala` → `final case class DateBucketConfig` (19), `def evaluate` (59), `def decode` (24), `val companion` (182). All four present. Match.

P15: `grep -n ... PanelConfigCodec.scala` → three defs (`encodeConfig` 29, `decodeCreateConfig` 53, `applyConfigPatch` 72); six kind arms under each (Text, Markdown, Image, Divider, Output, Form). Match.

P16: callers listed by `git grep -n 'PanelConfigCodec\.(encodeConfig|decodeCreateConfig|applyConfigPatch)(' -- backend/src/main`. encodeConfig: DashboardProtocol, PanelProtocol, PatchSetApplyRollback. decodeCreateConfig: DashboardSnapshotRepository, DashboardServiceValidation, DashboardSnapshotImport, PanelServiceHelpers. applyConfigPatch: PanelMutationRepository, BatchControlsCheck, PanelBindingChecks, PanelPatchApplier, PatchSetPreviewProjection. Match.

P17: `git grep -c 'case PanelConfigCodec\.(Text|Markdown|Image|Divider|Output|Form)Create' -- backend/src/main` → PanelServiceHelpers.scala:8, DashboardSnapshotRepository.scala:6, PatchSetApplyResolvers.scala:2. `git grep -n 'case FormPanel.Kind'` → PanelConfigCodec.scala:62 and PanelRowMapper.scala:46. Match.

P18: `sed -n 58,70p PanelSpec.scala` → `Panel.Registry.keySet shouldBe Set(` with six `*.Kind` entries (Text, Markdown, Image, Divider, Output, Form). Match.

P19: `grep -n 'git grep -l -i divider' Panel.scala` → line 140. 1 line. Match.

P20: threshold measurement → five panel-kind enums with 5–6 hits (dashboard-proposal ProposalPanel.type = 5; create-panel-request, create-panels-batch-request, panel, update-panels-batch-request type = 6); every other enum at most 1. Match.

P21 (after edit): `git grep -n 'panels.items.type.enum' -- scripts frontend helio-mcp .github` → no output, exit=1. Match.

P22: registry-driven test inventory. `git grep -l 'PipelineStep.Registry\|PipelineStepKind.All' -- backend/src/test frontend/src helio-mcp/src` lists PipelineStepSpec, PipelineStepRepositorySpec, PipelineAnalyzeServiceSpec, PipelineCostEstimatorSpec, PipelineStepCatalogServiceSpec, PipelineStepSecondSourceGuardSpec and stepNarrowing.test.ts, with no helio-mcp file. The three greps each print ≥ 1 line (PipelineStepRepositorySpec:110; PipelineAnalyzeServiceSpec:1534; stepNarrowing.test.ts:694). Match.

4.2 (old overclaims gone):
- Positive control on base: `git show HEAD:...PipelineStep.scala | grep -c -i -E '...'` → 6. Match.
- New tree: `grep -n -i -E '...' PipelineStep.scala; echo exit=$?` → no lines, exit=1. Match.
- `grep -n -i 'single source of truth' PanelConfigCodec.scala PanelSpec.scala PipelineService.scala; echo exit=$?` → no lines, exit=1. Match.

4.3: `git grep -c -l -i datebucket -- backend/src/main frontend/src helio-mcp/src ':!*.test.*' | wc -l` → 39 (≥ 30). Match.

## Gates

3.1 `node scripts/check-schema-drift.mjs; echo exit=$?`
```
check-schema-drift: raw recursive walk found 150 entries under .../HEL-1412/schemas
schemas in sync with JsonProtocols (122 checked across 54 protocol files)
panel-type enums in sync with backend canonical sets (9 surfaces checked)
panel-kind enum coverage: 5 schema enums detected, each checked or exempted
AssistantProposalToolSchemas.scala in sync with schemas/ (14 surfaces checked)
exit=0
```

3.2 `npm run check:schemas:selftest; echo exit=$?` → all 14 cases `ok`, including the five HEL-1412 cases (findPanelKindEnums, unchecked enum fails, checked+exempted pass, reasonless/stale/both fail, real exemption table has reasons), then `check-schema-drift selftest: all cases passed`, exit=0.

5.1 `cd backend && nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.model.PanelSpec com.helio.domain.model.PipelineStepSpec"` (tail)
```
[info] PanelSpec:
[info] - should have exactly the 6 panel kinds as its key set
[info] PipelineStepSpec:
[info] Tests: succeeded 44, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
exit=0
```

5.2 Comment-only proof: `git diff -U0` over the three main Scala files, filtered to drop comment lines, → no output. `git diff -U0 -- PanelSpec.scala` → exactly one `-`/`+` pair (the test name, line 59).

5.3 `openspec validate registry-overclaims-and-batch-drift --type change` → `Change 'registry-overclaims-and-batch-drift' is valid`, exit=0.
