## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD d390a62e65554fab359866bd3c6eae44c00829d0. The change dir is untracked, so no code has changed yet.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/chart-aggregate-tail-slots/HEL-1390`.
- **Premise (1): the chart tail writes invalid slots.** Confirmed.
  - `frontend/src/features/pipelines/ui/outputEditor/buildOutputConfig.ts` (chart branch of `buildAggregateTailConfigs`) writes `fieldMapping: { category: params.groupBy, value: alias }`.
  - `backend/.../domain/panels/OutputBindingSpec.scala:73-78` defines `Chart` with required slots `xAxis`/`yAxis`, optional slots `series`/`annotation`, and `yAxis -> Numeric`.
  - So the planned `{ xAxis: groupBy, yAxis: alias }` mapping is valid, and the alias of an aggregate is numeric.
- **Premise (1): the server rejects the write and the step is rolled back.** Confirmed.
  - `usePipelineDetailPage.ts:802-846` creates the step, then wraps `createOutput` in a try block whose catch deletes the step and rethrows. The failure is visible to the user, and nothing is stored.
- **Premise (1): "HEL-906 predates HEL-908".** Confirmed.
  - `git log -S"category: params.groupBy"` first finds 834e848c HEL-908 (#508), dated 2026-09-02.
  - `git log -S"Unknown fieldMapping slot"` first finds cc4cf679 HEL-906 (#506), dated 2026-09-01.
  - Slot validation therefore came first. The ticket's "no bad rows, no migration" conclusion holds.
- **Premise (2): the examples carry a panel-level aggregation.** Confirmed.
  - `AssistantProposalToolSchemas.scala:116-123` is the dashboard example. Its output panel has `fieldMapping`, `aggregation`, `label` and `unit`.
  - `:342-348` is the combined example. Its panel has `fieldMapping` and `aggregation`.
  - `ProposalPanelSupport.scala:316-318` shows `buildDataConfig` emits only `{outputId}` when the panel type is `output`, so those keys do nothing.
  - `PatchSetExample` (`:408`) has the summary "update its unit", but its patch only renames the panel. The design's fix for this is justified.
- **Premise (2): "render-only" is stale.** Confirmed.
  - The remodel design doc says it at L31, L72 and L152.
  - `openspec/specs/pipeline-output-sheet/spec.md:46-53` ("attaches the Output to it as a render-only Output").
  - `KnownKeys` gives Chart and Metric an `aggregation` key (`OutputConfigValidation.scala:21-28`).
- **Premise (3): the tidy-ups.**
  - `doc shouldBe a[String]` is present at `AssistantProposalToolSchemasSpec.scala:276`.
  - The long chained line is present at `PipelineService.scala:690`, inside `validateOutputFieldMapping` (~L683). The design cites ~L689, which is close enough.
  - The ticket says the "both prompts" wording is already fixed. Confirmed: `archive/2026-10-08-validate-output-config-keys/design.md:125` now reads "all three in-app surfaces", and the phrase survives only in archived evaluation and skeptic reports, which are historical records. Excluding it from scope is correct.
- **D4's metric config passes the validator.**
  - `metricShape` (`OutputConfigValidation.scala:138-152`) accepts `{agg}` when `fieldMapping.value` is set.
  - `validateConfig(kind, written, stored)` exists (`:180`) and returns `Either[ServiceError, Unit]`.
  - `KnownKeys` is a `Map[OutputKind, Set[String]]`, so D5's "union of values" can be computed.
- **D5's test surface exists.**
  - The spec already reads examples via `AssistantProtocol.assistantTools` (`examplesOf`, spec L27-35).
  - `assistantTools` is at `AssistantProtocol.scala:100`.
- **The spec deltas match the specs.**
  - The MODIFIED requirement header matches the live spec exactly and keeps the existing metric scenario.
  - The new chart scenario's `sum_amount` matches the builder's alias form `${aggFn}_${yField}`.
  - The ADDED assistant requirement extends the existing worked-example requirement (`assistant-conversation-loop/spec.md:89`) without contradicting it.
- **Coverage:**
  - AC1 is covered by tasks 2.1 and 4.1 (red-first) and by the D3 live seam check.
  - AC2 is covered by 1.1–1.3 and 4.2–4.4. D5 derives its key sets from `KnownKeys`, never from a hand-copied list, and mutation must show it red.
  - AC3 is covered by 1.4, 3.1, 4.5 and the spec delta.
  - No scope drift: the panel wire-schema removal is correctly excluded as a non-goal.

### Verdict: CONFIRM

### Non-blocking notes

- D4's combined example binds a metric Output with `fieldMapping.value: "signups"` directly to an inline REST root (`steps: []`).
  - Proposal grounding (`resolveOneProposalOutputAnalysis` → `validateOutputFieldMapping` → `validateFieldMappingColumnsExist`, PipelineService ~L1529) checks that column exists at that root's schema.
  - D5(b) uses `validateConfig`, which does not check column existence. So the test proves the shape is valid, not that apply grounding will accept it.
  - Consider attaching the Output to a `cast` step (`signups` → integer), as `PipelineProposalExample` does. That would make the teaching example realistic about numeric eligibility (`value -> Numeric`).
  - Optional; the placeholder nature of the examples makes this cosmetic.
- D3 assigns the live seam probe to the evaluator, but tasks.md has no matching task. The executor should still do the probe itself before claiming AC1 complete, rather than relying on the unit test alone.
- Several unrelated test fixtures still use `{category, value}` as chart `chartFieldMapping`: `buildOutputConfig.test.ts:123-134` and `OutputEditorSheet.configPatch.test.tsx:188-261`. They test the non-tail path and are out of scope, but they keep teaching invalid chart slot names. This is a candidate follow-up.
