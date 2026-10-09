## Context

- `buildAggregateTailConfigs` (`frontend/src/features/pipelines/ui/outputEditor/buildOutputConfig.ts` ~L204-223) builds
  the chart Output config for "Add as tail with aggregate" with `fieldMapping: { category: groupBy, value: alias }`.
  `OutputBindingSpec.Chart` (backend `domain/panels/OutputBindingSpec.scala`) declares slots `xAxis`, `yAxis`
  (required), `series`, `annotation`; `OutputConfigValidation.validateFieldMapping` 400s anything else. The chart
  renderer (`features/panels/history/chartOverlay.ts`, `ChartOutputPanel`) and the sheet's normal create path read
  `xAxis`/`yAxis`. `usePipelineDetailPage.handleAddOutputViaAggregateTail` creates the step, the Output create 400s,
  and the step is deleted: the chart tail path is a visible failure, never a silent store.
- The metric branch writes `{ value: alias }`, valid for `OutputBindingSpec.Metric`. Unchanged.
- `AssistantProposalToolSchemas` examples: `DashboardProposalExample` (~L112) and `CombinedProposalExample` (~L323)
  give an `output` panel `fieldMapping`/`aggregation` (and `label`/`unit` in the dashboard one).
  `ProposalPanelSupport.buildDataConfig` emits only `{outputId}` for an `output` panel, so all of these are inert.
- `AssistantProposalToolSchemasSpec` already decode-pins every example and checks `KeysDoc` coverage.

## Goals / Non-Goals

**Goals:** chart tail writes valid slots (red-first test); examples corrected and asserted against `KnownKeys`;
stale "render-only" text corrected; two tidy-ups.

**Non-Goals:** changing the panel proposal wire schema; changing `OutputConfigValidation`/`OutputBindingSpec`; the
already-fixed "both prompts" wording.

## Decisions

**D1. Chart tail mapping is `{ xAxis: groupBy, yAxis: alias }`.** The aggregate step passes `groupBy` columns
through and emits the aggregate under `alias` (existing comment at ~L170), so those are exactly the x and y columns.
No `series` (the aggregate groups by one column, so no series column survives) and no field-mode `annotation` (an
annotation column would not survive the aggregate either); literal annotation stays as today. Alternative rejected:
copying the sheet's `chartFieldMapping` keys, since they name pre-aggregation columns that do not exist at the new node.

**D2. Frontend red-first test asserts the exact mapping and slot membership.** In `buildOutputConfig.test.ts`
(or a sibling test file): the chart tail result's `fieldMapping` equals `{ xAxis, yAxis }` and every key is in the
chart slot set `["xAxis","yAxis","series","annotation"]`, stated in the test with a comment citing
`OutputBindingSpec.Chart` as its source (the frontend has no shared slot constant; capabilities supply slots at
runtime). Must be shown red against the unfixed builder first. The metric branch gets the same slot-membership check
against `["value","label","unit"]`.

**D3. Live seam evidence.** Unit tests alone cannot prove the server accepts the write (client/server can each pass
while disagreeing). The evaluator SHALL exercise the real flow against the running worktree app: chart Output sheet
on a step node, set group-by/agg/y-field, "Add as tail with aggregate" → `POST /api/pipelines/:id/outputs` returns
2xx, the aggregate step persists, the Output row's stored `config.fieldMapping` is `{xAxis, yAxis}`, and the chart
renders. Use a throwaway user; delete its residue by exact id.

**D4. Example corrections.** Dashboard example output panel → `{ title, type: "output", outputId }`. Combined example
panel → `{ title, type: "output", outputId: "$pipelineOutput" }`; its pipeline gains a `cast` step (`signups` → integer, clientId `s1`, as
in the pipeline example) and its Output becomes a `metric` attached via `nodeStepClientId: "s1"` with
`config: { fieldMapping: { value: "signups" }, aggregation: { agg: "sum" } }` (a valid metric shape per
`OutputConfigValidation.metricShape`), so the examples teach where aggregation actually lives. The sentinel, `roots`
and decode-pinning requirements stay satisfied. `PatchSetExample`'s summary "...and update its unit" (a panel has no
unit, and the patch only renames) becomes a summary matching the patch.

**D5. Example test derives from `KnownKeys`.** New tests in `AssistantProposalToolSchemasSpec` read each
`propose_*` tool's `inputSchema.examples` from `AssistantProtocol.assistantTools` (the rendered surface, not the
private vals), and: (a) for every panel with `type == "output"` (at any depth: dashboard panels, combined
`dashboard.panels`), assert its keys ∩ `KnownKeys.values.flatten` is empty, failing with the offending key;
(b) for every proposed Output (`outputs[]` under a pipeline or combined `pipeline`) and every patch-set edit whose
`target.kind` is an Output, run `OutputConfigValidation.validateConfig(kind, config, JsObject.empty)` and assert
`Right`; (c) assert at least one example Output carries a non-null `aggregation`; (d) assert the walk found at least
one output panel and one Output (so it cannot pass vacuously). The executor SHALL show each of (a)/(b) red by mutation
(re-add the panel `aggregation`; add a bogus key to the example Output config) and restore.

**D6. Stale "render-only".** In the 2026-08-30 remodel design doc, append a dated correction note next to decision 2
(L31) and the L72/L152 lines rather than rewriting history: Output config carries an optional chart/metric
`aggregation` (validated since HEL-1313); aggregate steps remain the way to reshape data. The live
`pipeline-output-sheet` spec text is corrected via this change's MODIFIED delta.

**D7. Tidy-ups.** Delete `doc shouldBe a[String]` (AssistantProposalToolSchemasSpec ~L276). Break the
`PipelineService.validateOutputFieldMapping` chained line (~L689) into one call per line with no behaviour change.

## Risks / Trade-offs

- Example changes alter what the model sees; risk is low since the removed keys were inert and the new metric config
  is validator-checked by D5.
- The hard-coded chart slot list in the frontend test can drift from `OutputBindingSpec.Chart`; D3's live check is
  the seam evidence, and the backend list has its own `OutputBindingSpecSpec`.

## Planner Notes

- Self-approved: D4's PatchSetExample summary fix (same defect class, same block, one string).
- Premise correction: HEL-1313 did not cause the 400 (HEL-906 #506 predates HEL-908 #508); no stored bad rows, so no
  migration (V121 untouched).
