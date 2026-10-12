## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 849dd96c936182d4a8c8597c3cbdc92ae39fcb82 (the change dir is untracked; there is no code diff yet). I did not relitigate owner rulings Q1-Q3.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/time-axis-chart-followups/hel-1508`.

- **Round-1 CR1 parts (a)-(d) are each now specified.**
  - (a) D1a defines one exported, echarts-free `resolveChartPlan({appearance, rawRows, headers, fieldMapping, chartAggregate, chartOptions, fieldTypes})` in `utils/chartTimeAxis.ts`. It owns:
    - the chart type, via `resolveChartType(appearance?.chart ?? defaultChartAppearance)`;
    - `timeCtx`;
    - the aggregate rule (bar/line/pie);
    - the empty short-circuit;
    - `timePlan`.
  - (b) `buildChartOption.ts` ~137-158 is replaced by one call to the resolver. The Non-Goals and Risks lines were amended to match, so the round-1 contradiction is gone.
  - (c) `ChartRenderer` calls the same function. D3 states that it never reads `appearance.chart.chartType` directly.
  - (d) The D7 guard is now full-chain. It checks `resolveChartPlan(...).timePlan.kind` against `buildChartOption(...).xAxis.type` over the requested matrix:
    - absent `appearance.chart`;
    - scatter plus `chartAggregate`;
    - horizontal bar;
    - aggregate grouped by a timestamp;
    - auto-detect with no numeric column.
    
    It is mutation-proven twice. Tasks 1.4, 1.5 and 2.2 carry this.
  - The round-1 non-blocking notes are folded in:
    - the auto-detect `{}` case returns `none`;
    - D1a states the scatter-without-y routing;
    - each x is parsed once;
    - the echarts version is 6.1.0;
    - overlay eligibility is pinned by a test.

- **The decision sites quoted in D1a match the code exactly** (`buildChartOption.ts:133-157`):
  - `appearanceToEChartsOption(appearance?.chart ?? defaultChartAppearance, ...)` gives `chartType` (`chartAppearance.ts:181`, which is `resolveChartType(chart)`, defaulting to `"line"` at `:158-159`);
  - `useAggregate = chartAggregate != null && bar|line|pie`;
  - `timeCtx = {fieldTypes, horizontalBar: bar && orientation === "horizontal"}`;
  - the `rawRows && rawRows.length > 0 && headers && headers.length > 0` short-circuit, which otherwise gives `{}`.

- **"Same props" is true: no transform sits between ChartRenderer and buildChartOption.**
  - `ChartRenderer.tsx:94-107` forwards `appearance`/`rawRows`/`headers`/`fieldMapping`/`chartAggregate`/`chartOptions`/`fieldTypes` to `ChartPanel` unchanged.
  - `ChartPanel.tsx:89-98` forwards them unchanged to `useChartOption`.
  - `useChartOption.ts:96-110` forwards them unchanged to `buildChartOption`.
  - So a resolver called in ChartRenderer on its own props sees exactly the inputs `buildChartOption` sees.

- **Can `defaultChartAppearance` and `resolveChartType` be imported into `utils/chartTimeAxis.ts` without runtime echarts or a cycle? Yes.**
  - `defaultChartAppearance` lives in `frontend/src/theme/appearance.ts:19`, not in `utils/chartAppearance.ts`. That file's imports (lines 1-3) are all `import type` (`./theme`, dashboard types, panel types).
  - `utils/chartAppearance.ts` imports only these: `import type` from echarts (line 1), panel types (type), `./prefersReducedMotion` (no imports) and `./chartTypes` (no imports).
  - `chartClickSelection.ts` runtime-imports only `./chartTypes`; the rest are type imports.
  - None of these modules imports `chartTimeAxis.ts`, so there is no cycle. `chartTimeAxis.ts` has no imports today.
  - **Bundle probe (rolldown 1.0.3, the worktree's own bundler).** I bundled an entry importing `resolveChartType` (chartAppearance), `defaultChartAppearance` (theme/appearance), `isTimeXField` (chartTimeAxis) and `resolveDataColumns` (chartClickSelection), with `--external echarts`.
    - Result: exit 0, a 3.15 kB output, and **0** occurrences of `echarts`.
    - The bundled regions are only theme/appearance, chartClickSelection, `resolveChartType` and the chartTimeAxis regexes.
    - The one tree-shake residue is a top-level `new Intl.NumberFormat(...)` from chartAppearance.ts. It is negligible.
    - The probe is in the scratchpad `probe2/`, outside the worktree.
  - `chartAppearance.ts` is already statically reachable from the main bundle today, through `resolvePanelChartType.ts:3` (used by `ChartOutputPanel.tsx` and `usePanelCardInspect.ts`). So the import adds no new main-chunk module.
- **Is passing the plan into the data builders coherent with the exported signatures, callers and tests? Yes.**
  - `buildDataOption(rawRows, headers, fieldMapping, chartType, scatterOptions?, histogramOptions?, timeCtx?)` (`chartDataOptions.ts:43-51`) and `buildAggregateDataOption(aggregate, chartType, timeCtx?)` (`:228-232`) have exactly two production call sites, both in `buildChartOption.ts:146/148`.
  - The only direct test caller is `buildChartOption.heatmapHistogram.test.ts:196`, `buildDataOption(rows, headers, {xAxis:"ms"}, "histogram")`. It passes no `timeCtx`, and histogram returns before any time logic.
  - No test imports `wantsTimeAxis`, `TimeAxisContext` or the `buildTime*` builders.
  - So a trailing optional `timePlan` parameter, or a required one, breaks no existing caller. D1's re-export of `wantsTimeAxis`/`TimeAxisContext` from `chartTimeDataOptions.ts` keeps `chartDataOptions.ts:13-21` compiling.
- **`wantsTimeAxis` moves cleanly.** `chartTimeDataOptions.ts:15-30` uses only `isTimeXField` (already in `chartTimeAxis.ts`) and the `ChartType` type.
- **The spec delta still validates.** `openspec validate time-axis-chart-followups --type change --strict` printed "Change 'time-axis-chart-followups' is valid". Round 1 already proved the RENAMED+MODIFIED archive on a scratch copy, and the revision did not touch `specs/`.
- **AC coverage is unchanged from round 1, and every AC still maps to a task.**
  - AC1: D2, tasks 1.2-1.3, D7a-d
  - AC2: D3, tasks 2.x, D7e
  - AC3: D4, tasks 3.x, D7f-h
  - AC4: D5
  - AC5: D6
  - AC6: D7/D8, tasks 5.x
  
  The revision introduces no scope beyond the ACs.

### Verdict: CONFIRM

CR1 is fully addressed, and I found nothing new that blocks implementation.

### Non-blocking notes

1. **D1a's wording misplaces `defaultChartAppearance`.** It says "import `resolveChartType`/`defaultChartAppearance` from `utils/chartAppearance.ts` ... or moves the constant". The constant lives in `theme/appearance.ts`, which is already runtime-echarts-free (verified above). The executor should import it from there and **not** move it.
2. **The plan-parameter shape is unspecified.** The suggested shape is a trailing optional `timePlan?: TimeAxisPlan` on `buildDataOption`/`buildDataOptionCore`/`buildAggregateDataOption`. When it is absent, the builder computes it with the same `planTimeAxis`/`planAggregateTimeAxis`, never an inline re-derivation. That keeps `buildChartOption.heatmapHistogram.test.ts:196` unchanged. "Each x parsed once" means the `time`/`category-fallback` plan variants must carry the parsed instants. D1's declared return type `{kind:"time", omitted}` does not show that field yet, so widen the type rather than re-parse.
3. **Guard mutation (ii) must make the two decisions disagree.** "compute its own horizontalBar and ignore the plan" only turns red if the local computation differs from the resolver's. An example is a local `horizontalBar: false` with a horizontal-bar timestamp case in the matrix. A faithful copy stays green and proves nothing.
4. **Two duplicated rules must stay owned by the plan, not copied from the builder.**
   - the auto-detect "has a numeric column" rule, which decides `none` versus `time`;
   - the aggregate `line|bar` restriction (`chartDataOptions.ts:233-236`; pie aggregate must be `none`).
   
   The full-chain guard will catch a disagreement in either, as long as both cases stay in the matrix.
5. **The proposal's Impact file list omits `buildChartOption.ts`,** which D1a now edits. Refresh the list when writing the PR body.
