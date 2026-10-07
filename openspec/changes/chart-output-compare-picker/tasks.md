## Standing Constraints

- [C1] Owner ruling show-with-inline-note: chart Compare picker is never hidden; fixed help text + Output-level note only; no new "previous" copy.

## 1. Frontend

### Frontend

- [x] 1.1 Add `chartCompareBlocker(config)` to `features/panels/history/chartOverlay.ts` per design D5 (no change to existing exports' behaviour)
- [x] 1.2 Rename `metricCompare` → `compare` across `OutputEditorSheet.tsx` and `buildOutputConfig.ts` (D2); shared state initialised from `config.compare`
- [x] 1.3 Chart branch and chart aggregate-tail branch of `buildOutputConfig.ts` write `compare: compareOrNull(compare)` (D4)
- [x] 1.4 Add `CHART_COMPARE_OPTIONS` and generalise `compareOptions` to append stored `previous_run`/`custom:` values (D3); metric options unchanged
- [x] 1.5 Render the chart Compare section in `ChartKindFields` with help text + blocker note, `aria-describedby` wiring, existing hint classes (D6, D7)
- [x] 1.6 Verify in the RUNNING app (own ports 6782/9689, own headless context) in light and dark against DESIGN.md; screenshots into the worktree

## 2. Tests

### Tests

- [x] 2.1 Unit tests for `chartCompareBlocker` (each blocker, order, clean config, pie chartType alone → null), red-first
- [x] 2.2 RTL in `OutputEditorSheet.compare.test.tsx`: replace the chart-omits-compare test; cover D8's list, red-first
- [x] 2.3 Update `buildOutputConfig.test.ts`/tail tests for the rename and chart `compare`
- [x] 2.4 E2E `e2e/hel1350-chart-compare-picker.spec.ts` per D8, both themes; run locally `nice -n 19` with ≤2 workers; record created ids
- [x] 2.5 Full gates: lint, typecheck, format:check, Jest (frontend); no backend changes so no sbt run
