## Standing Constraints

- [C1] Red first: every behaviour test in D7 is shown failing on main (output saved under `.concertino/runs/HEL-1508/evidence/`) before the fix lands; a guard is labelled GUARD and mutation-proven.
- [C2] No new `eslint-disable`; no `--no-verify`/`HUSKY=0`/hooksPath override; ECharts options carry only hex-resolvable colours (no `color-mix()`).
- [C3] Running-app checks use a throwaway `@example.test` user registered by the agent (id recorded up front, verified via `/api/auth/me`); never matt@helio.dev; created data deleted by exact id.
- [C4] Local caps (HEL-1442): `nice -n 19` on heavy jobs; never pkill/pgrep/killall; shut down every server you start.

## 1. Shared time-axis plan (D1, D2)

- [x] 1.1 Move `wantsTimeAxis` + `TimeAxisContext` into `frontend/src/utils/chartTimeAxis.ts` (echarts-free), re-export from `chartTimeDataOptions.ts`
- [x] 1.2 Add `planTimeAxis` (none | time{omitted} | category-fallback) and `planAggregateTimeAxis` (none | time{omittedGroups}) with the D2 fallback predicate (vertical bar, one point per row, repeated instant by epoch millis)
- [x] 1.3 `buildDataOptionCore` / `buildAggregateDataOption` branch on the plan (auto-detect with no numeric column -> plan `none`); add the category-fallback output (instant-ordered rows, unparseable x last)
- [x] 1.4 `resolveChartPlan` (D1a) in `utils/chartTimeAxis.ts`; `buildChartOption.ts` ~137-158 replaced by one call to it; data builders take the plan (no second parse/derivation)
- [x] 1.5 GUARD test (full chain): `resolveChartPlan(...).timePlan.kind` agrees with `buildChartOption(...).xAxis.type` and the note over the D7 matrix; mutation-proven (two mutations)

## 2. Omitted-x note (D3)

- [x] 2.1 `timeAxisOmittedNote` text (rows / groups, singular/plural, null at 0)
- [x] 2.2 `ChartRenderer` renders it in the histogram-note slot/classes, from `resolveChartPlan(...)` over exactly the props it forwards to `ChartPanel`
- [x] 2.3 RTL test: note on a time chart with an unparseable x; absent on a category chart and when nothing omitted

## 3. Non-numeric y is a gap (D4)

- [x] 3.1 Category single-series and auto-detect: NaN y -> null
- [x] 3.2 Time single-series and auto: `[t, null]`
- [x] 3.3 Scatter (both axes, with/without colorField): rows with non-numeric y produce no point
- [x] 3.4 Audit every reader of single-series `series.data` for null handling; list in PR body
- [x] 3.5 Update existing NaN->0 pinning tests, each listed in the PR body as an intended behaviour change

## 4. Spec + docs (D5, D6)

- [x] 4.1 Spec delta validates (`openspec validate time-axis-chart-followups --type change`)

## 5. Verification (D8)

- [x] 5.1 Unit tests red-first (D7 a-h), then green; lint, typecheck, format
- [x] 5.2 Running-app check: fallback bars distinct, gap draws no 0, notes; light/dark at 1440 and 375
- [x] 5.3 e2e: hel1305, hel1306, hel1311, hel1512 pass
