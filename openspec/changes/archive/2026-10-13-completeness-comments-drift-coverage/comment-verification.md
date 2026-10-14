# HEL-1467 comment verification (C1)
Each factual sentence in a rewritten comment, with the command that verifies it and its output (run in the worktree at the end of the change).

## 1. PipelineStepSpec
S1: "PipelineStep trait is NOT sealed".

- Command: `grep -n 'trait PipelineStep ' backend/src/main/scala/com/helio/domain/model/PipelineStep.scala`
```
39:trait PipelineStep {
```
S2: "PipelineStepKind.All parity test fails when a registered kind is missing from allSubtypes" (All is Registry.keySet; the test compares sets).

- Command: `grep -n 'def All' backend/src/main/scala/com/helio/domain/model/PipelineStep.scala; grep -n 'kinds shouldBe PipelineStepKind.All' backend/src/test/scala/com/helio/domain/model/PipelineStepSpec.scala`
```
374:  def All: Set[String] = PipelineStep.Registry.keySet
126:      kinds shouldBe PipelineStepKind.All
```
S3: "an unlisted subtype without an arm raises a MatchError at runtime" (the match has no default arm).

- Command: `sed -n '/each subtype in allSubtypes maps/,/^    }/p' backend/src/test/scala/com/helio/domain/model/PipelineStepSpec.scala | grep -c 'case _ =>'`
```
0
```
Test passes (sbt testOnly, 5 suites, 122 tests, 0 failed; see task 3.2 output in the final report).

## 2. PipelineStepConfigCodec
S4: "the match is on Any".

- Command: `grep -n 'def encodeConfig(config: Any)' backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineStepConfigCodec.scala`
```
54:  def encodeConfig(config: Any): String = config match {
```
S5: "a config class with no arm falls to case other and throws IllegalArgumentException".

- Command: `grep -n -A3 'case other' backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineStepConfigCodec.scala | head -5`
```
48:   *  class with no arm here falls through to the `case other` arm and throws
49-   *  `IllegalArgumentException` at runtime. Today the test that catches that is
50-   *  `DraftRoundTripWriteSafetySpec`, which runs every `PipelineStep.Registry` kind's draft
51-   *  through this method; `PipelineStepConfigCodecSpec`'s round-trip case lists its kinds by
--
```
S6: "DraftRoundTripWriteSafetySpec runs every Registry kind's draft through encodeConfig"; "PipelineStepConfigCodecSpec's round-trip case lists its kinds by hand".

- Command: `git grep -n 'drafts.keySet shouldBe PipelineStep.Registry.keySet\|PipelineStepConfigCodec.encodeConfig(typed)' -- backend/src/test; git grep -n 'val cases: Seq\[(String, Any)\]' -- backend/src/test/scala/com/helio/api/protocols/pipelines/PipelineStepConfigCodecSpec.scala`
```
backend/src/test/scala/com/helio/domain/steps/DraftRoundTripWriteSafetySpec.scala:51:      drafts.keySet shouldBe PipelineStep.Registry.keySet
backend/src/test/scala/com/helio/domain/steps/DraftRoundTripWriteSafetySpec.scala:58:        val reEncoded = PipelineStepConfigCodec.encodeConfig(typed)
backend/src/test/scala/com/helio/api/protocols/pipelines/PipelineStepConfigCodecSpec.scala:398:      val cases: Seq[(String, Any)] = Seq(
```
S7: callers re-derive command.

- Command: `git grep -n 'PipelineStepConfigCodec.encodeConfig' -- backend/src`
```
backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineStepConfigCodec.scala:53:   *  `git grep -n "PipelineStepConfigCodec.encodeConfig" -- backend/src`. */
backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineStepConfigCodec.scala:84:        s"PipelineStepConfigCodec.encodeConfig: unexpected config type ${other.getClass.getName}"
backend/src/main/scala/com/helio/domain/model/PipelineStep.scala:253:   *  It is not the only kind list: `PipelineStepConfigCodec.encodeConfig` and
backend/src/main/scala/com/helio/domain/model/PipelineStep.scala:341:   *   - protocol / codec: `PipelineStepConfigCodec.encodeConfig`,
backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepository.scala:1365:    PipelineStepConfigCodec.encodeConfig(config)
backend/src/main/scala/com/helio/services/patchsets/PatchSetPreviewProjectionSteps.scala:56:   *  defensive `Left`, mirroring `PipelineStepConfigCodec.encodeConfig`'s
backend/src/test/scala/com/helio/api/protocols/pipelines/PipelineStepConfigCodecSpec.scala:424:        val encoded = PipelineStepConfigCodec.encodeConfig(cfg)
backend/src/test/scala/com/helio/api/protocols/pipelines/PipelineStepConfigCodecSpec.scala:434:      val encoded = PipelineStepConfigCodec.encodeConfig(cfg)
backend/src/test/scala/com/helio/domain/steps/DraftRoundTripWriteSafetySpec.scala:58:        val reEncoded = PipelineStepConfigCodec.encodeConfig(typed)
```
S8: upsertsource arm now uses the Registry (and is registered); behavior-equivalent: the companion encodes with the same toJson.compactPrint (round-trip + byte-identity test added in PipelineStepConfigCodecSpec).

- Command: `git grep -n 'UpsertSourceStep.Kind -> UpsertSourceStep.companion' -- backend/src/main; grep -n 'def encodeConfig' backend/src/main/scala/com/helio/domain/steps/UpsertSourceStep.scala`
```
backend/src/main/scala/com/helio/domain/model/PipelineStep.scala:280:    UpsertSourceStep.Kind -> UpsertSourceStep.companion,
69:    def encodeConfig(config: Any): String = config.asInstanceOf[UpsertSourceConfig].toJson.compactPrint
```
S9: Registry kind-count command used in the secondaryDataSourceId scaladoc.

- Command: `sed -n '/val Registry/,/^  )/p' backend/src/main/scala/com/helio/domain/model/PipelineStep.scala | grep -c -- '->'`
```
27
```
S10: "the *Config case classes share no sealed parent" (unchanged claim): no sealed trait named *Config in the domain.

- Command: `git grep -n 'sealed trait .*Config' -- backend/src/main/scala/com/helio/domain | head -5`
```
backend/src/main/scala/com/helio/domain/panels/PanelConfigCodec.scala:43:  sealed trait CreateConfig
```

## 3. domain/steps/README.md
S11: registered kinds = 27 (see S9). S12: 24 per-op specs; groupby, join, upsertsource have none.

- Command: `ls openspec/specs | grep -c -- '^pipeline-.*-op$'; ls openspec/specs | grep -- '^pipeline-.*-op$' | tr '\n' ' '`
```
24
pipeline-aggregate-op pipeline-analyzewithai-op pipeline-assert-op pipeline-cast-op pipeline-chunk-by-token-count-op pipeline-compute-op pipeline-convertformat-op pipeline-date-bucket-op pipeline-dedupe-op pipeline-extract-headings-op pipeline-fillnull-op pipeline-filter-op pipeline-generatetext-op pipeline-limit-op pipeline-lookup-op pipeline-pivot-op pipeline-rename-op pipeline-select-op pipeline-sort-op pipeline-split-text-op pipeline-string-ops-op pipeline-union-op pipeline-unpivot-op pipeline-window-op ```

- Command: `ls openspec/specs | grep -i 'groupby\|group-by\|pipeline-join\|upsert'`
```
pipeline-join-column-collision
pipeline-join-step-editor
pipeline-joinstep-right-source-acl
pipeline-upsertsource-config
pipeline-upsertsource-editor
pipeline-upsertsource-execution
```
S13: the 23 figure is historical (HEL-814 time).

- Command: `git log --oneline -3 --format='%h %s' -S'23 step kinds' -- backend/src/main/scala/com/helio/domain/steps/README.md`
```
82026d58d Document the sole-config trap for step config requiredness (#492)
```

## 4. PipelineShape.scala
S14: Registry drives shapeFor and the catalog.

- Command: `git grep -n 'PipelineShape.Registry' -- backend/src/main | head`
```
backend/src/main/scala/com/helio/domain/shapes/PipelineShape.scala:11: *  `Registry` pattern): discipline is enforced via [[PipelineShape.Registry]] — only shapes
backend/src/main/scala/com/helio/domain/shapes/PipelineShape.scala:15:  /** Stable identifier, e.g. `"passthrough"` — the [[PipelineShape.Registry]] key. */
backend/src/main/scala/com/helio/services/pipelines/PipelineShapeService.scala:34: *  which predates that instruction). No repository or `ActorSystem` dependency: `PipelineShape.Registry`
backend/src/main/scala/com/helio/services/pipelines/PipelineShapeService.scala:41:    PipelineShape.Registry.values.toVector
backend/src/main/scala/com/helio/services/pipelines/PipelineStepCatalogService.scala:27: *  `PipelineShapeService`'s relationship to `PipelineShape.Registry`. */
```
S15: other layers hard-code shape ids (frontend ShapePickerModal SHAPE_DISPLAY_ORDER, pipelineService.ts, helio-mcp tools + scripts/verify.ts, PipelineShapeSpec, PipelineShapeRoutesSpec).

- Command: `git grep -n -l 'pivot-matrix' -- ':!openspec'`
```
backend/src/main/scala/com/helio/domain/shapes/PipelineShape.scala
backend/src/main/scala/com/helio/domain/shapes/PivotMatrixShape.scala
backend/src/test/scala/com/helio/api/routes/pipelines/PipelineShapeRoutesSpec.scala
backend/src/test/scala/com/helio/domain/shapes/PipelineShapeSpec.scala
backend/src/test/scala/com/helio/domain/shapes/PivotMatrixShapeEngineSpec.scala
backend/src/test/scala/com/helio/domain/shapes/PivotMatrixShapeSpec.scala
backend/src/test/scala/com/helio/services/pipelines/CreateStepConfigNonRegressionSpec.scala
frontend/src/features/pipelines/services/pipelineService.ts
frontend/src/features/pipelines/ui/shapes/ShapePickerModal.tsx
helio-mcp/scripts/verify.ts
helio-mcp/src/tools/pipelines.ts
helio-mcp/src/tools/read.ts
```

## 5. PipelineStepSecondSourceGuardSpec
S16 (cycle 2): the spec iterates PipelineStep.Registry.

- Command: `grep -n 'PipelineStep.Registry' backend/src/test/scala/com/helio/api/protocols/pipelines/PipelineStepSecondSourceGuardSpec.scala | head -4`
```
17: *  location-agnostic. This spec iterates `PipelineStep.Registry` -- the map the backend's step
40:  "secondaryDataSourceId/secondaryLaneStepId, exercised via PipelineStep.Registry" should {
44:      PipelineStep.Registry.foreach { case (kind, companion) =>
103:      PipelineStep.Registry.size should be > 0
```
S16b: `PipelineStepKind.All`'s scaladoc names the hand-enumerated layers.

- Command: `sed -n '/^object PipelineStepKind/,/def All/p' backend/src/main/scala/com/helio/domain/model/PipelineStep.scala | grep -n 'Spec\|Codec\|Protocol\|stepNarrowing' | head -12`
```
35:   *   - protocol / codec: `PipelineStepConfigCodec.encodeConfig`,
36:   *     `PipelineStepProtocol`, `PipelineAnalyzeProtocol`, and
49:   *     `state/stepNarrowing.ts`, `hooks/useStepCardState.ts`, the
57:   *  test time: `PipelineStepSpec` (pins this set to a literal list),
58:   *  `PipelineStepRepositorySpec` (inserts and decodes a row of every kind,
59:   *  so the CHECK constraint and row mapping), `PipelineAnalyzeServiceSpec`
60:   *  (an `inferOutputSchema` branch per kind), `PipelineCostEstimatorSpec`,
61:   *  `PipelineStepCatalogServiceSpec`, `PipelineStepSecondSourceGuardSpec`,
62:   *  `PatchSetPreviewProjectionStepsRegistryGuardSpec` (a patch-set preview projection arm per kind),
63:   *  and the frontend `stepNarrowing.test.ts` (a `STEP_ICONS` entry per
```
S16c: the frontend keeps its own kind lists (the three named files) and the re-derive command finds them.

- Command: `git grep -l chunkbytokencount -- backend/src frontend/src helio-mcp/src | grep -c .`
```
36
```

- Command: `git grep -l chunkbytokencount -- frontend/src | grep 'pipelineStep.ts\|stepNarrowing.ts\|StepOpEditor.tsx'`
```
frontend/src/features/pipelines/state/stepNarrowing.ts
frontend/src/features/pipelines/types/pipelineStep.ts
frontend/src/features/pipelines/ui/StepOpEditor.tsx
```

S17 (README join/upsertsource spec names, full names):

- Command: `ls openspec/specs | grep -- '^pipeline-join'; ls openspec/specs | grep -- '^pipeline-upsertsource'`
```
pipeline-join-column-collision
pipeline-join-step-editor
pipeline-joinstep-right-source-acl
pipeline-upsertsource-config
pipeline-upsertsource-editor
pipeline-upsertsource-execution
```

S18 (PipelineShape layer list vs its re-derive command): the named layers are all in the command's output; the comment now says the command also returns more and the list is examples.

- Command: `git grep -n -l 'pivot-matrix' -- ':!openspec'`
```
backend/src/main/scala/com/helio/domain/shapes/PipelineShape.scala
backend/src/main/scala/com/helio/domain/shapes/PivotMatrixShape.scala
backend/src/test/scala/com/helio/api/routes/pipelines/PipelineShapeRoutesSpec.scala
backend/src/test/scala/com/helio/domain/shapes/PipelineShapeSpec.scala
backend/src/test/scala/com/helio/domain/shapes/PivotMatrixShapeEngineSpec.scala
backend/src/test/scala/com/helio/domain/shapes/PivotMatrixShapeSpec.scala
backend/src/test/scala/com/helio/services/pipelines/CreateStepConfigNonRegressionSpec.scala
frontend/src/features/pipelines/services/pipelineService.ts
frontend/src/features/pipelines/ui/shapes/ShapePickerModal.tsx
helio-mcp/scripts/verify.ts
helio-mcp/src/tools/pipelines.ts
helio-mcp/src/tools/read.ts
```

S19 (enumKey doc): exemption keys are compared as written (`key in exemptions`), only detected/covered keys are normalized.

- Command: `grep -n 'key in exemptions\|enumKey(file, path)' scripts/lib/panelKindEnumCoverage.mjs`
```
16:/** Panel-kind enums deliberately NOT parity-checked. Key: enumKey(file, path); value: the reason.
24:export function enumKey(file, path) {
116:  const coveredKeys = new Set(covered.map(({ file, path }) => enumKey(file, path)));
117:  const detectedKeys = new Set(detected.map(({ file, path }) => enumKey(file, path)));
119:    if (!coveredKeys.has(key) && !(key in exemptions)) {
```


## Residual scan: none of the false claims remain

- Command: `git grep -n -i 'single source of truth' -- backend/src/main/scala/com/helio/domain/shapes/PipelineShape.scala backend/src/test/scala/com/helio/api/protocols/pipelines/PipelineStepSecondSourceGuardSpec.scala; git grep -n -i 'compile error\|sealed-trait dispatch\|23 step kinds' -- backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineStepConfigCodec.scala backend/src/test/scala/com/helio/domain/model/PipelineStepSpec.scala backend/src/main/scala/com/helio/domain/steps/README.md; echo '(no hits above = none)'`
```
backend/src/main/scala/com/helio/domain/steps/README.md:21:every field across the 23 step kinds registered when it ran and found **eight** where a shipped
(no hits above = none)
```
(Residual hit above for README:21 is the intentional historical figure: "the 23 step kinds registered when it ran" (HEL-814).)

## Cycle 3
The SecondSourceGuardSpec scaladoc was re-split so the spec is again the subject of "decodes a default config and calls the REAL extractors"; the re-derive command moved to its own paragraph. No factual wording changed, so S16-S16c stand (re-run below). The other rewritten comments were reread whole (PipelineStepSpec, codec encodeConfig/secondaryDataSourceId, PipelineShape, README); only the README join sentence needed re-wrapping.
```
36
```

## Cycle 4 (C5: quote the spec content; each entry has its command)
S20: upsertsource write path tolerates absent target/mode (README sentence: tolerated as incomplete draft).

- Command: `sed -n '45,46p' openspec/specs/pipeline-upsertsource-config/spec.md`
```
is not `"append"` or `"replace"`. An absent `target` or `mode` SHALL NOT be rejected — an
incomplete draft is not a write-time error.
```
S20b: upsertsource empty dataSourceId is "savable, not runnable".

- Command: `sed -n '95p' openspec/specs/pipeline-upsertsource-config/spec.md`
```
SHALL remain an incomplete draft (savable, not runnable). Every create path SHALL be covered: the single-call pipeline
```
S21: join add tolerates empty right input.

- Command: `sed -n '9,11p' openspec/specs/pipeline-join-step-editor/spec.md`
```
The pipeline step catalog SHALL report the `join` kind as authorable, and the pipeline step palette SHALL
offer it to the user. Adding a join step from the palette SHALL succeed with the seed config
`{"secondaryInput": {"kind": "source", "dataSourceId": ""}, "joinKey": "", "joinType": "inner"}` and SHALL
```
S21b: join analyze reports an empty dataSourceId as incomplete, like other unset required fields.

- Command: `sed -n '9p;19,21p' openspec/specs/pipeline-step-config-validation/spec.md`
```
Validation of a `join`, `union` or `lookup` step config at analyze time SHALL report, as named config problems, a `secondaryInput` that is absent, carries an unrecognised `kind`, or pairs a `kind` with the wrong field — via the same validation path the run-time completeness check uses, so the two cannot disagree. A `source`-kind input with an empty `dataSourceId` SHALL be reported as an incomplete configuration in th
#### Scenario: An unset source-kind input is reported as incomplete, not invalid
- **WHEN** a config carries `{"secondaryInput": {"kind": "source", "dataSourceId": ""}}`
- **THEN** analyze reports it as an incomplete configuration, consistent with other unset required fields
```
S21c: join run with an empty joinKey fails naming joinKey as missing required.

- Command: `sed -n '24,29p' openspec/specs/pipeline-step-config-runtime-completeness/spec.md`
```

#### Scenario: A join step with no join key fails the run
- **GIVEN** a pipeline containing a `join` step whose `joinKey` is the empty string
- **WHEN** the pipeline is run
- **THEN** the run fails
- **AND** the error names that step and identifies `joinKey` as the missing required value
```
S22: groupby statement in pipeline-run-execution.

- Command: `sed -n '131,133p' openspec/specs/pipeline-run-execution/spec.md`
```
The execution engine SHALL support the `groupby` op. The config SHALL contain `groupBy` (array of
column names), `aggColumn` (column to aggregate), and `aggFunction` (`"sum"` or `"count"`). The
result SHALL contain one row per unique group with the group key columns and an aggregated value
```
S22b: search of ALL specs for groupby config statements (README: other specs describe analyze projection / unsupported function; none found states absent/empty legitimacy). Hits outside pipeline-run-execution that concern the groupby STEP: pipeline-analyze-api:267-300 (projection of a valid config; a groupBy column missing from input degrades best-effort, validationError absent), pipeline-step-config-validation:49-52 (unsupported function reported). Remaining hits are the aggregate op, chart/Output aggregation, or unrelated words (chart-history-overlay, shape-registry, blank-category-label, etc.): none is a groupby-step requiredness statement.

- Command: `grep -rn -i 'groupby' openspec/specs | grep -v 'pipeline-run-execution' | grep -i 'step\|pipeline-analyze-api\|config-validation' | cut -c1-200`
```
openspec/specs/pipeline-analyze-api/spec.md:91:#### Scenario: Aggregate step produces groupBy fields plus aggregation aliases
openspec/specs/pipeline-analyze-api/spec.md:92:- **WHEN** an aggregate step has `config: {"groupBy": ["region"], "aggColumn": "amount", "aggFunction": "sum", "alias": "total_amount"}`
openspec/specs/pipeline-analyze-api/spec.md:267:### Requirement: Analyze projects a real output schema for a groupby step
openspec/specs/pipeline-analyze-api/spec.md:269:`GET /api/pipelines/:id/analyze` MUST NOT report a `validationError` for a `groupby`
openspec/specs/pipeline-analyze-api/spec.md:273:The projected schema is the step's `groupBy` key fields, in config order, followed by a
openspec/specs/pipeline-analyze-api/spec.md:275:`GroupByStep.apply` emits at run time. `GroupByConfig` carries no alias field, so no
openspec/specs/pipeline-analyze-api/spec.md:283:#### Scenario: valid groupby reports no validationError
openspec/specs/pipeline-analyze-api/spec.md:285:- **WHEN** a pipeline containing a `groupby` step with a valid config is analyzed
openspec/specs/pipeline-analyze-api/spec.md:288:#### Scenario: groupby projects group keys plus the aggregate column
openspec/specs/pipeline-analyze-api/spec.md:290:- **WHEN** a `groupby` step groups by `order_id` and applies `sum` to a `float` column `amount`
openspec/specs/pipeline-analyze-api/spec.md:295:- **WHEN** a `groupby` step applies `count` to a `float` column `amount`
openspec/specs/pipeline-analyze-api/spec.md:300:- **WHEN** a `groupby` step names a `groupBy` column that is not present in its input schema
openspec/specs/pipeline-shape-registry/spec.md:157:#### Scenario: aggregate mode expands to one empty-groupBy aggregate step
openspec/specs/pipeline-step-config-validation/spec.md:49:#### Scenario: An unsupported groupby function is reported at analyze time
openspec/specs/pipeline-step-config-validation/spec.md:50:- **GIVEN** a pipeline containing a `groupby` step whose aggregation function is not supported
openspec/specs/pipeline-join-step-editor/spec.md:16:- **THEN** the `join` entry is reported authorable, and `groupby` is the only entry reported unauthorable
openspec/specs/pipeline-steps-persistence/spec.md:16:`op` (TEXT with CHECK constraint: one of 'rename', 'filter', 'join', 'compute', 'groupby',
openspec/specs/pipeline-analyze-schema-warnings/spec.md:20:For an enabled step with no `validationError`, the system SHALL emit one `field-not-in-input-schema` warning per distinct input field name th
openspec/specs/output-panel-placement/spec.md:47:- **THEN** the migration creates an aggregate (or groupBy+aggregate) tail step
openspec/specs/pipeline-step-config-rejection/spec.md:177:- **WHEN** the caller creates a pipeline in one request with filter, aggregate (object-form `groupBy`), sort and select
openspec/specs/pipeline-aggregate-op/spec.md:46:config `{"groupBy":[],"aggregations":[]}` and render AggregateConfig in the StepCard body when
openspec/specs/pipeline-aggregate-op/spec.md:51:- **THEN** a new step is created and persisted with config `{"groupBy":[],"aggregations":[]}`
```

- Command: `sed -n '49,52p' openspec/specs/pipeline-step-config-validation/spec.md`
```
#### Scenario: An unsupported groupby function is reported at analyze time
- **GIVEN** a pipeline containing a `groupby` step whose aggregation function is not supported
- **WHEN** the pipeline is analyzed
- **THEN** that step's `validationError` names the unsupported function and lists the supported ones
```

- Command: `sed -n '267,271p;298,301p' openspec/specs/pipeline-analyze-api/spec.md`
```
### Requirement: Analyze projects a real output schema for a groupby step

`GET /api/pipelines/:id/analyze` MUST NOT report a `validationError` for a `groupby`
step whose config is valid, and MUST project that step's real output schema rather than
an identity passthrough of its input.
#### Scenario: a group-key field absent from the input schema degrades best-effort

- **WHEN** a `groupby` step names a `groupBy` column that is not present in its input schema
- **THEN** that step's `validationError` is absent and the key field is projected using the documented best-effort fallback type
```
S23: README no longer says the specs "bless" an empty value for join/upsertsource and no longer says "the only statement".

- Command: `grep -n -i 'bless\|the only statement' backend/src/main/scala/com/helio/domain/steps/README.md`
```
22:capability spec explicitly blesses the empty or absent value.
59:requiredness statements live in other specs, and the ones cited below do not bless an empty
```

C5 re-check: every other README/comment sentence about spec content was grepped across all of openspec/specs for the step kind: upsertsource (also pipeline-step-preview:159-171, pipeline-upsertsource-editor:17,46: empty draft add accepted / preview 422 for empty new-source name - consistent, not stronger) and join/secondaryInput (patch-set-apply:51, pipeline-joinstep-right-source-acl:40, pipeline-step-config-read-strictness:60: all treat empty as an incomplete draft - consistent with the README).
