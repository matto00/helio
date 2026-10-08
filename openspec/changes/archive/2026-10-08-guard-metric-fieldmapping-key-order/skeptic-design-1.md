## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 945128faac04e3a1ef3b82628323af5a9558dc61 (change dir untracked; no code diff yet).

### What I verified (with evidence)

**(a) Premise: no order-dependent metric path remains.** I searched the tree myself rather than relying on the plan's list.
- `grep -rnE "Object\.(values|entries|keys)\([^)]*\)\[0\]"` across `frontend/src` and `helio-mcp/src` (non-test files): 0 hits.
- Backend `grep -rnE "fields\.(head|values\.head|toSeq\.head|headOption)|fields\.keys\.head"` in `backend/src/main`: one hit, `StepCodecUtil.scala:230` (`forall`, not a pick).
- Server rule: `OutputSummaryReducer.scala:90-92` resolves `stringField(config,"fieldMapping","value")`, then `aggregation.value`, by key. `OutputFilteredMetric.compute` re-reads config from DB (`findConfigsByIdsInternal`) and calls `metricField`/`metricOf`. Its callers are `OutputService.scala:377` and `PublicPanelRowsResolver.scala:89`. The only `OutputKind.Metric` consumers are the reducer, `OutputBindingSpec`, `OutputFilteredMetric` and `PanelPacker` (layout sizing).
- Client: `metricHistoryView.ts:24-32` (`resolveServerMetricField`) resolves by key. `MetricOutputPanel.tsx` gets `valueColumn`, filtered-metric identity and the history headline (via `selectMetricHistoryView`) all from that function. `CollectionRenderer.tsx:32` is per-slot `Object.entries`, so it does not depend on order. `crossFilterRows.ts:125` uses `Object.values(...).includes(...)`, which also does not depend on order. `OutputEditorSheet.tsx:241-251` reads `.value` / `.label` / `.unit` by key.
- Alerts (`HistoryBaseline.summaryValue`) take an explicit metric name, not a fieldMapping. helio-mcp only uses `fieldMapping` in descriptions and types.
- Conclusion: the premise holds. The plan's path list is complete for metric value.

**(b) Planned tests turn red under the stated mutations and are not vacuous.**
- Server mutation (first `fieldMapping` entry instead of `.value`) feeds `metricField`, which both `metricOf` (history) and `OutputFilteredMetric` (the `listFieldCells` projection of the chosen field) use. Under D1 fixtures (a numeric label column that differs from the value column), a label-first config yields a different exact number. Both the reducer spec and the routes spec go red.
- Client mutation in `resolveServerMetricField`:
  - (a)/(b) loaded value comes from the wrong column.
  - (c) the server `filteredMetric.field` ("amount") no longer matches the resolved field ("rank"). It is discarded and the panel falls back to the wrong-column loaded value.
  - (d) the headline identity no longer matches and falls back the same way.
  - All four go red under D1.
- CollectionRenderer is correctly labelled a GUARD, with a mutation that injects a positional pick.
- The D3 and D4 preconditions (assert the first key is not `value`) stop a "label-first" test from silently degrading into a value-first test. That addresses MISTAKES.md's "precondition guarantees it" trap.
- I checked existing coverage. `OutputSummaryReducerSpec:65` and `metricHistoryView.test.ts:24` test only value-first multi-key mappings. `CollectionRenderer.test.tsx:5` uses value-first. No label-first case exists today, so AC2 really is outstanding.

**(c) jsonb key-ordering claim.** I ran a read-only SELECT against the dev Postgres:
- `'{"value":"amount","label":"rank"}'::jsonb::text` returns `{"label": "rank", "value": "amount"}`.
- `{"value","unit","label"}` returns `{"unit","label","value"}`.
- The nested `fieldMapping` inside a full config is also reordered.

So the claim (length first, then bytewise) is correct. `outputs.config` is `JSONB` (`V94__outputs_model.sql:213`) and is read back through `MappedColumnType.base[JsObject,String]` (`OutputRepository.scala:306`). spray-json 1.3.6 on Scala 2.13.15 (immutable `Map1..Map4` keeps insertion order for at most 4 entries) keeps the reordered order, which makes D3's precondition meaningful. If that ever changed, D3 fails loudly by design, and the explicitly label-first-written seed keeps the case independent of jsonb. D4's claim about `Map1..Map4` order is correct for the 2- and 3-key mappings used.

**(d) Out-of-bounds files.** The proposal Non-goals, C1 and tasks name only test files plus one spec delta. `PanelContent.metricHistory.test.tsx` and a new `MetricOutputPanel.keyOrder.test.tsx` are not `PanelCard.tsx`, `usePanelData.ts`, `outputConfigTypes.ts` or the schemas.

**Spec delta.** I compared the MODIFIED requirement with `openspec/specs/output-snapshot-history/spec.md`. It preserves every existing scenario and the requirement text, adding only the key-order sentence and one scenario. `openspec validate guard-metric-fieldmapping-key-order --strict` returns "valid".

**Placeholders / contradictions / scope.** No TODO/TBD. The tasks match the design decisions D1–D6. AC1 is covered by the MetricOutputPanel displayed-value test and AC2 by all the tests. AC3 (single-key mapping unchanged) is already met on main, no production code changes, and existing single-key tests (`OutputSummaryReducerSpec:60,76,80`) remain. No API or schema change, so no contract delta is needed.

### Verdict: CONFIRM

### Non-blocking notes
- 2.2(c)/(d): proving that the filteredMetric / headline branch was actually taken also needs the injected filteredMetric/headline value to differ from the loaded-rows value-column value. Otherwise "accepted" and "fell back to loaded rows" look the same. D1 handles the mutation case but does not state this. The executor should pick distinct numbers, for example a headline or filtered value of 999 against loaded 42 against rank 7.
- 2.3: with D1, the label column's cell is also rendered as the item label. Assert on the value element, or on the value's text being present, and make sure the mutation is placed after the slot loop so it is not overwritten.
- Optional: `shared-test-fixtures/output-summary-reducer.json` (the client/server seam fixture, consumed by `OutputSummaryReducerSeamSpec` and the client) is a natural home for one label-first case, so both sides stay pinned to agreeing on key order. Not required: the per-side tests already cover it.
- Spec scenario example `{label: "region", value: "amount"}` uses a string label column. Tests should use D1's numeric label column. This is only a wording difference and is harmless.
