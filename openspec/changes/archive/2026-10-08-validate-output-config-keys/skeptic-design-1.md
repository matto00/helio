## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed against worktree HEAD 55b7c4269d90eea7f3c71f3a2e3857a4018ee47b (change dir untracked, planning only).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/output-config-key-validation/hel-1313`.

### What I verified (with evidence)

**Probe 1: is the per-kind known-key set complete?** Mostly yes. Every writer I found emits only keys in the spec's set:
- Frontend editor `buildOutputConfig.ts`: chart chartType/fieldMapping/aggregation/chartOptions/annotation/compare. Table fieldMapping/columnOrder/columnFormats. Metric fieldMapping/aggregation/label/unit/format/compare. Markdown content/fieldMapping. Collection fieldMapping/layout/format. Timeline fieldMapping/sort. The `buildAggregateTailConfigs` path emits the same keys. `OutputEditorSheet.withHistoryPayloads` adds the cross-kind `historyPayloads`.
- `TableRenderer.tsx` L252/262/274 writes only columnSort, columnFilters and pinnedColumns. `columnWidths` is local state only (L302-304) and is not persisted.
- `FirstRunPlanner.scala` L71/L130 (shared by `PersonaTemplates`) writes columnOrder, plus chartType bar/line with fieldMapping. Both are in the set and in the enum.
- Shape expansions (`usePipelineDetailPage.ts` L926) use outputs from the backend, and backend shapes produce none. `DashboardProposal`'s legacy panel fields (seriesColors etc.) are panel wire shape, not Output config. `controls`, `outputId`, `imageUrl` etc. are panel config, not Output config.
- Every reader of Output config (frontend `read*Config`, `chartOverlay.ts`, `metricHistoryView.ts`, `OutputSummaryReducer`) reads only keys in the set. Grepping for `legend`/`tooltip`/`seriesColors`/`axisLabels` on Output config across frontend/src, backend/src/main and helio-mcp/src finds zero readers; the only hits are the panel `ChartAppearance` in model.scala L273-291. e2e fixtures send only fieldMapping/chartType/content.
- Gap: the key set is complete, but the planned aggregation shape rule for metric is not. See CR2.

**Probe 2: is removing the HEL-877 deep merge safe?** Yes. Under D3 a `legend`/`tooltip`/`seriesColors`/`axisLabels` value can only be written if it equals the stored value. For that case shallow and deep merge produce identical results, so no stored data can change. No reader exists. AC1 asks for exactly this: never-read keys must stop being silently accepted. I see no product call that needs escalation, and the BREAKING note plus the MODIFIED spec delta disclose it.

**Probe 3: is every write path covered?** The plan covers `OutputService.create` (L133), `update` (L244), `PatchSetPreviewProjection` (L135-136), patch-set apply (via `update`, `PatchSetApplyForward` L104), single-call create (`PipelineService` L642) and proposal grounding (L1506). Patch-set pipeline create (`PatchSetApplyForward` L87) and pipeline proposal apply both go through `pipelineService.create`, so they are covered. `OutputRepository.insertInternal` has exactly two other callers: OutputService and `PatchSetUndoService.restoreBoundOutputs` L297. The latter is a raw restore of journaled state that is correctly left unvalidated (tolerance), though the design never mentions it. **Patch-set rollback (`PatchSetApplyRollback` L181) is covered but the design's handling of it is wrong. See CR1.**

**Probe 4: is the AC2 reading sound?** Yes. HEL-1351 applies a well-formed `{groupBy, agg, yField}` through `ChartOutputPanel.tsx` (`chartAggregationSpec`, chartOverlay.ts L42), mirrored by `OutputSummaryReducer` L108-122. `ChartOutputPanel.aggregate.test.tsx` exists with real grouping assertions (L79, L90, L109). Rejecting the shapes that are silently ignored (malformed shape, a scatter chart, non-aggregating kinds) is a sound reading of "affects the chart or is rejected". The test plan in 4.1, 4.5 and 4.6 is real. Panel-appearance scatter overriding an aggregated Output is disclosed as a non-goal, which is acceptable.

**Probe 5: does anything force a choice the ticket forbids?** No. D3 tolerance avoids a migration, and the ticket permits 400.

### Verdict: REFUTE

### Change Requests

1. **D3 breaks patch-set rollback, and the design's Risks bullet saying "cannot occur for new patch sets" is false.** Rollback (`PatchSetApplyRollback.scala` L181) re-sends the full `priorConfig` through `OutputService.update`. Under D3/D5, a forward patch that *fixes* stored state is accepted, but its rollback re-introduces the old value, which now "differs from stored" and is re-validated, so the rollback returns 400 and is marked `unrecoverable`. Concrete realistic case: a stored chart with `chartType: scatter` and a well-formed `aggregation`. D7 itself says the current editor produces this, by switching an aggregated chart to scatter. A forward patch sets `{chartType: "bar"}` and is accepted. The rollback writes `chartType: scatter`, which differs from the stored value, so the scatter rule fires and returns 400. The same happens for a forward patch that fixes a malformed aggregation (`agg: "median"`) or an invalid stored `chartType`. Required changes:
   - Exempt journaled-state restoration from the new key/aggregation/chartType checks. Two options: an explicit restore mode on `update`, or have rollback validate against the journal's priorConfig. Do not exempt it by loosening the normal path.
   - Correct the Risks bullet.
   - Add a test to 4.4: forward `chartType` scatter→bar on a scatter+aggregation Output, then rollback, expecting `rolledBack`. Also add the malformed-aggregation-fix variant.

2. **The D5 metric aggregation rule rejects a shape the server and dashboard actually apply.** `OutputSummaryReducer.metricField` (L90-93) and the client port `resolveServerMetricField` (`metricHistoryView.ts`) take the field from `fieldMapping.value` first and `agg` from `aggregation.agg` independently. `MetricOutputPanel.tsx` L76-78 then aggregates with `cfg.aggregation.agg`. So `{fieldMapping: {value: "amount"}, aggregation: {agg: "max"}}` is an effective, tested configuration: `OutputSummaryReducerSpec` L66 and L92, plus `metricHistoryView.test.ts` L12. D5 requires `{value, agg}` with both fields non-empty, so it would 400 a config that renders. That is the reverse of the ticket's intent. Required change: define the metric rule from the resolved-config semantics:
   - `agg` must be in count|sum|avg|min|max (or absent).
   - `aggregation.value` is optional and must be a non-empty string if present.
   - At least one of `fieldMapping.value` / `aggregation.value` must resolve in the resulting config.
   - Optionally, reject `aggregation.value` that differs from a present `fieldMapping.value`, because that one *is* silently ignored.
   Update the spec scenario wording and test 4.1 to match.

3. **D7's claim that "the editor already surfaces a save 400 message via saveError" is false.** `OutputEditorSheet.tsx` L355-356 catches and sets the fixed string `"Failed to save output."`, discarding the server message. Either correct the claim or, preferably, surface the 400 message. The ticket's value is an actionable "names the key" error, and the in-app editor is a write path that would show a generic failure. If the fix is kept out of scope, record that explicitly.

### Non-blocking notes
- D3 makes it impossible to clear a stored legacy key: `{"metricLabel": null}` differs from the stored value and is rejected. The shallow merge stores JsNull rather than deleting anyway. Consider accepting `null` for an unknown key that is already stored, so owners can clean up, or record it as a follow-up alongside the legacy-key rewrite non-goal.
- Task 4.2 should name an explicit route-level malformed-`aggregation` 400 case (POST and PATCH) so AC2's "(tested)" has a seam test, not only the unit spec.
- Task 2.3 should also cover the deep-merge doc comments in `helio-mcp/src/helioApi.ts` L1125-1126 and `helio-mcp/src/types.ts` L244, not only the tool description in `tools/outputs.ts` L122.
- Mention `PatchSetUndoService.restoreBoundOutputs` (a raw insert, deliberately unvalidated) in the design so a future reviewer doesn't "fix" it.
