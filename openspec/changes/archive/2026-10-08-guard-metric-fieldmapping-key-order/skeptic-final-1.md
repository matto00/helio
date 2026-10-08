## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `b6ce14d1ad17cdff4f72cdda718dc373ea5f9af7`. Base resolved live via `resolve-review-base.sh` → `945128faac04e3a1ef3b82628323af5a9558dc61`.

### What I verified (with evidence)

- **Spawn guard**: `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=task/metric-fieldmapping-key-order-guard/HEL-1182`.
- **Diff scope** (`git diff 945128faa...HEAD --stat`): tests only (OutputSummaryReducerSpec, OutputFilteredMetricRoutesSpec, metricHistoryView.test.ts, new MetricOutputPanel.keyOrder.test.tsx, new CollectionRenderer.keyOrder.test.tsx), the shared fixture `shared-test-fixtures/output-summary-reducer.json` (+1 metricField case), and change artifacts. No production code. Out-of-bounds grep (`usePanelData|outputConfigTypes|^schemas/|PanelCard.tsx`) → no hits.
- **Premise (AC1/AC3 met on main)**: `OutputSummaryReducer.metricField` (OutputSummaryReducer.scala:90-93) and `resolveServerMetricField` (metricHistoryView.ts:24-31) resolve `fieldMapping.value` then `aggregation.value` by key; `MetricOutputPanel.tsx:70-80` takes `valueColumn` from that resolver; `OutputFilteredMetric.scala:32` is the only other server caller. Grep for remaining positional `Object.values(...mapping)[0]` picks found only `crossFilterRows.ts:125` (`.includes`, order-independent). AC3 (single key) already covered by existing "value mapping only"/"lone label"/"lone unit" fixture cases.
- **Path coverage (restated scope)**: client resolver, MetricOutputPanel (a) first-row, (b) aggregate, (c) filteredMetric identity, (d) history headline; server reducer `summarize`/`metricField`; both route paths (authenticated `GET /outputs/:id/rows` and public `GET /dashboards/:d/panels/:p/rows`); CollectionRenderer (as GUARD); shared client/server seam fixture. Every listed path has a test.
- **Clean runs**: frontend 3 suites, 59/59 pass; backend `sbt testOnly OutputSummaryReducerSpec OutputSummaryReducerSeamSpec OutputFilteredMetricRoutesSpec` → `succeeded 120, failed 0`.
- **Client mutation (re-run by me)**: `nonEmptyString(mapping?.value)` → `nonEmptyString(Object.values(mapping)[0])`. Result: every non-control case red — resolveServerMetricField label/unit/unit+label-first (9 tests), MetricOutputPanel (a)-(d) for label/unit/unit+label-first (12 tests), shared-fixture `metricField: label and unit listed before value (HEL-1182...)` red in aggregate.fixture.test.ts. Value-first cases stay green and are labelled "(baseline control)". Reverted; `git status` clean apart from untracked evaluation-2.md.
- **Server mutation (re-run by me)**: line 91 `stringField(config,"fieldMapping","value")` → first `fieldMapping` field's string. Result 33 failures incl. all 12 new reducer cases, the new seam case, and all 8 new route cases (both routes x 4 orders), failing at the field assertion (`"rank" was not equal to "amount" (OutputFilteredMetricRoutesSpec.scala:271/288)`), i.e. past the precondition. This confirms the D3/D4 finding: spray-json's parsed JsObject iterates alphabetically, so even the "value-first written" case is non-value-first at `metricField` and goes red. Reverted; tree clean.
- **CollectionRenderer GUARD mutation (re-run by me)**: added a positional `item.value = row[headers.indexOf(Object.values(fieldMapping)[0])]` → 3 failed / 1 passed (control). Labelled "GUARD ... not a red-first test" in the file. Reverted; tree clean.
- **Vacuity check (D1)**: in every case the decoy column is numeric and different (rank 7/8 vs amount 42/10; rank = amount+1000 on routes; rank = 100+i in reducer), with exact-number assertions; mutations produce wrong numbers or wrong field names, not blanks.
- **Spec delta**: `openspec validate guard-metric-fieldmapping-key-order --strict` → valid; the MODIFIED header matches `openspec/specs/output-snapshot-history/spec.md:92` verbatim.
- **Lint/format**: prettier --check and eslint --max-warnings=0 on the new/changed frontend files and the fixture → clean.
- **UI judgment**: there are no UI changes (tests only), so I skipped step 4 and did not start the servers.

### Verdict: CONFIRM

### Non-blocking notes
- The D3 precondition `assertStoredNotValueFirst` and the reducer `keys.head should not be "value"` checks always hold, because spray-json iterates alphabetically and `value` sorts last among label/unit/value. design.md D3/D4 says so honestly. The comment in OutputFilteredMetricRoutesSpec still overstates it: the block comment ("reads back with `value` LAST" because of jsonb) and the docstring ("the config as Postgres returns it") credit Postgres for an order that the spray parse actually imposes. The tests are not vacuous, because the mutation proves they go red. A future edit could align the comment with D3.
- `metric.fields("value") should not be JsNumber(rankEastSum)` is redundant after the exact `shouldBe JsNumber(eastSum)`. It is harmless.
- `evaluation-2.md` is untracked. The orchestrator must commit it at delivery, as stated.
