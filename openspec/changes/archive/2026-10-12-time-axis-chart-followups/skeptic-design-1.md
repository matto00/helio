## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 849dd96c936182d4a8c8597c3cbdc92ae39fcb82 (the change dir is untracked; no code diff yet).
I did not relitigate owner rulings Q1-Q3. I only judged whether the design implements them faithfully and soundly.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/time-axis-chart-followups/hel-1508`.
- **Spec delta archives cleanly (RENAMED + MODIFIED).**
  - `openspec validate time-axis-chart-followups --type change --strict` printed "Change 'time-axis-chart-followups' is valid" (openspec 1.10.0).
  - I ran a real `openspec archive time-axis-chart-followups -y` on a scratch copy of `openspec/` (scratchpad `archprobe/`, not the worktree). It printed "~ 3 modified, → 1 renamed ... Specs updated successfully".
  - In the resulting spec, the requirement header reads "A chart shows a gap where a series has no numeric value". Both new scenarios landed under it, and the 3 new time-axis scenarios landed under the time-axis requirement.
  - `openspec validate chart-field-data-rendering --type spec --strict` on the archived result printed "valid". The MODIFIED block correctly uses the post-rename header.
- **D2's risk: does ECharts dedupe equal strings in an explicit category `xAxis.data`? It does not.**
  - The installed version is **echarts 6.1.0** (`frontend/node_modules/echarts/package.json`), not 5.x.
  - Source check: `lib/data/OrdinalMeta.js` `createByAxisModel` keeps `categories = map(data, getName)` verbatim. Deduplication only applies on the `needCollect` path, i.e. when categories are collected from data rather than given.
  - Live probe: an SSR (svg) render with `xAxis.data = ['2026-10-01','2026-10-01','2026-10-03','n/a']` and bar data `[5, 9, null, 4]` gave 4 items. Categories were kept with the duplicate. The layouts were distinct, at x=72 (h=-77) and x=147 (h=-139), so the duplicate date has two separate bars. The `null` item had no height (no 0 bar).
  - So D2's fallback shape renders as intended. The running-app re-check in D8 is still worth doing, but D2 does not need an escalation.
- **Moving `wantsTimeAxis` + `TimeAxisContext` into `utils/chartTimeAxis.ts` keeps that module echarts-free.**
  - `chartTimeAxis.ts` has no imports today.
  - `wantsTimeAxis` needs only the `ChartType` type (type-only import, erased at build) and `isTimeXField` (same module).
  - The planned `planTimeAxis` would import `resolveDataColumns` from `utils/chartClickSelection.ts`. That module's runtime imports are only `./chartTypes`, which has zero imports. Every other import is `import type`. There is no import cycle, because `chartClickSelection` does not import `chartTimeAxis`. D1's module-placement claim holds.
- **Downstream axis handling keys off the built option, not a re-decision.**
  - `buildChartOption.ts:159` `plottedInstants(dataOption)` and `timeAxisOption.ts:22`, plus `chartOverlayOption.ts:95-97`, branch on `xAxis.type`. A `category-fallback` data option is therefore treated as category everywhere downstream, consistently.
  - `grep wantsTimeAxis` finds only two call sites, both in `chartDataOptions.ts` (lines 92 and 235).
- **Null readers spot-check (D4).** `toPercentShares` (`chartTypeOptions.ts:83-105`) already returns a `null` y unchanged. `Number(null)` adds 0 to the sum, which is harmless. The complete audit stays with task 3.4.
- **AC coverage.** Every AC maps to tasks:
  - AC1: 1.2/1.3 and D7a-d
  - AC2: 2.x and D7e
  - AC3: 3.x and D7f-h
  - AC4: D5 and the spec delta
  - AC5: D6
  - AC6: D7, 5.1-5.3
  
  I found no scope drift beyond the ACs. The Non-Goals faithfully exclude what Q1/Q2/Q3 do not name.
- **D3's claim that "the TimeAxisContext ChartPanel/buildChartOption builds is reachable from ChartRenderer without a second derivation" is false on this branch.** See CR1.
  - `buildChartOption.ts:137-158` builds `timeCtx` inline, as an unexported object literal: `{ fieldTypes, horizontalBar: chartType === "bar" && chartOptions?.bar?.orientation === "horizontal" }`.
  - On the same lines it decides `useAggregate = chartAggregate != null && chartType in {bar, line, pie}`.
  - `chartType` there comes from `appearanceToEChartsOption(appearance?.chart ?? defaultChartAppearance)` → `resolveChartType(chart)` (`chartAppearance.ts:158-159`, default `"line"`).
  - `buildChartOption` runs inside the lazy echarts chunk: `ChartRenderer.tsx:18` lazy-imports `ChartPanel` → `useChartOption` → `buildChartOption`. `ChartRenderer` (main bundle) therefore cannot reach that context. To call `planTimeAxis`/`planAggregateTimeAxis` it must re-derive three things: chartType (with the `"line"` default), `horizontalBar`, and the aggregate-vs-raw choice.
  - D3's input list cites `appearance.chart.chartType` (raw, no default) and is silent on the aggregate selection rule.

### Verdict: REFUTE

### Change Requests

1. **D3/D1, plus a Non-Goals contradiction: the note's inputs are a second derivation, and the design defers the fix to the executor.**
   - D3 says "The executor confirms where that context is assembled and passes it identically, with no second derivation". On this branch that is impossible as written, because the context and the raw-vs-aggregate choice are built inline in `buildChartOption.ts:137-158` behind the lazy boundary.
   - The Non-Goals also exclude "`buildChartOption.ts` restructuring" and Risks says "this change does not touch that file". That contradicts the only way to honour D1's stated goal ("one shared definition ... so they can never disagree").
   - D7's guard compares only `buildDataOptionCore` against `planTimeAxis` on given inputs. It cannot catch `ChartRenderer` resolving a different chartType or aggregate path. Concretely:
     - absent `appearance.chart` → buildChartOption plots `line`;
     - a scatter with a `chartAggregate` → buildChartOption takes the raw path.
   - Revise the artifacts to specify the following:
     - (a) An exported, echarts-free resolver in `utils/chartTimeAxis.ts`, e.g. `resolveChartTimePlan({ chart, rawRows, headers, fieldMapping, chartAggregate, chartOptions, fieldTypes })`. It owns:
       - the chartType resolution, via `resolveChartType` from `utils/chartAppearance.ts` (already imported by main-bundle editors; its echarts import is type-only);
       - the `timeCtx` construction;
       - the `useAggregate` rule (bar/line/pie only);
       - the empty-rows/headers short-circuit.
       
       It returns the plan.
     - (b) `buildChartOption.ts` gets its `timeCtx`/`useAggregate` from that same module (a small, named edit to that file, with the Non-Goal and Risk lines amended). An alternative is that it consumes the resolved plan directly.
     - (c) `ChartRenderer` calls the same resolver.
     - (d) The D7 GUARD is widened to the full chain. For a matrix that includes absent `appearance.chart`, scatter+aggregate, horizontal bar and aggregate grouped by a timestamp, the note's plan kind must agree with `buildChartOption(...).xAxis.type`. It is mutation-proven as already planned.
   - Update tasks 1.1-1.4 and 2.2 accordingly. The current "(no second derivation)" in task 2.2 is an acceptance signal with no defined way to meet it.

### Non-blocking notes

- echarts is 6.1.0. Any wording in the executor's PR body about "ECharts 5" behaviour should cite 6.1.0. The duplicate-category behaviour is confirmed above at source and runtime level, so D2's escalation tripwire should not fire.
- `planTimeAxis` parses every x once, and `timedRows` parses it again. That is fine at panel row counts, but the plan could carry the parsed instants to avoid the double parse.
- An auto-detect time chart with no numeric column returns `{}` from the builder, while `planTimeAxis` could still report `time{omitted>0}` and render a note under an empty chart. Have the plan return `none` when the builder would return `{}`, or state that the note is acceptable there.
- A scatter with no y mapping routes to the auto-detect branch. D4's "scatter point not drawn" covers only the `yCol !== -1` scatter branch. If that is intended, a one-line statement in D4 would close the gap.
- A fallback bar chart becomes overlay-eligible (`chartOverlayOption.ts` category path) where it was ignored on the time axis. D2 mentions this, so it is not a defect. Include it in the D8 running-app check if an overlay fixture is cheap.
