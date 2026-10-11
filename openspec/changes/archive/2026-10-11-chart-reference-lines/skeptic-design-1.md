## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed: `openspec/changes/chart-reference-lines/{ticket,proposal,design,tasks}.md`, `specs/chart-reference-lines/spec.md`,
`specs/output-routes-api/spec.md` (all untracked at review time; worktree HEAD = b3a7efc9639386784c888347770800189662a380 = main).
Owner rulings 1-7 were treated as settled and were not reopened.

### What I verified (with evidence)

**1. Every Output config write path reaches `OutputConfigValidation.validate`: CONFIRMED.**
- Create: `OutputService.scala:135` calls `validateConfig(kind, config, JsObject.empty)`, which calls `validate` (`OutputConfigValidation.scala`, `validateConfig` → `keyCheck`).
- PATCH: `OutputService.scala:208` does the same, with `stored`.
- Patch-set preview: `PatchSetPreviewProjection.scala:135` calls `OutputService.validateConfig`. Patch-set apply: `PatchSetApplyForward.scala:105` calls `outputService.update`.
- Single-call create: `PipelineCreateTransaction.scala:267` → `validateOutputFieldMapping` → `PipelineCreatePreflight.validateOutputConfig` (`PipelineServiceSupport.scala:71`) → `OutputConfigValidation.validate` (`PipelineCreatePreflight.scala:205`). Patch-set pipeline create goes through `PatchSetPipelineResolvers.scala:137` → `PipelineCreatePreflight.run`.
- Proposal grounding: `PipelineProposalAnalyze.scala:149` → `validateOutputFieldMapping`, which is the same chain.
- Paths that skip validation do so on purpose and need nothing new: rollback (`PatchSetApplyRollback.scala:185`, `RestorePriorStored`) and undo restore (`PatchSetUndoService.scala:301`, raw restore that is documented as intentional).
- Putting the new validator inside `validate` after `validateBinCount` is enough. No edit is needed anywhere else.

**2. The three listed schemas are the complete set: CONFIRMED.** I grepped `schemas/` for config-key-carrying files. Only the three named schemas have typed `config.properties`. `output.schema.json` and `public-output-meta-response.schema.json` declare `config: {type: object}` (opaque). `pipeline-proposal.schema.json` and `create-pipeline-request.schema.json` `$ref` the transactional output schema. `patch-set.schema.json` names `UpdateOutputRequest` in prose only. None of the three has `additionalProperties: false` on `config`.

**3. D5's premise (ECharts 6.1.0 does not widen an axis for a markLine): TRUE. D5's mechanism is wrong, and so is the bar-type carrier.**
I ran a Node SSR probe against the worktree's `frontend/node_modules/echarts` (version 6.1.0). It ran twice with identical output. The script and its output are reproduced verbatim at the end of this report. sha256 of the output: `745b34db…cd5`.
```
baseline                                     yExtent= [0,40] bar0 width= 103.5 x= 113.3
D5 min/max fns, mark=20 (inside data)        yExtent= [5,37.3] bar0 width= 103.5 x= 113.3
D5 min/max fns, mark=95 (above data)         yExtent= [5,95] bar0 width= 103.5 x= 113.3
6.1 dataMin/dataMax, mark=95                 yExtent= [0,100] bar0 width= 103.5 x= 113.3
6.1 dataMax only, mark=20                    yExtent= [0,40] bar0 width= 103.5 x= 113.3
empty bar carrier w/ markLine                yExtent= [0,40] bar0 width= 52.1 x= 110.3
empty line carrier w/ markLine               yExtent= [0,40] bar0 width= 103.5 x= 113.3
no extent fix, markLine 95 on series         yExtent= [0,40] bar0 width= 103.5 x= 113.3
```
- The last row confirms the premise: a mark at 95 leaves the axis at [0,40].
- The D5 `min`/`max` callbacks pin both ends of the axis. Source: `echarts/lib/coord/scaleRawExtentInfo.js` sets `fixMM[i] = noZoomEffMM[i] != null` when min/max is a function. Pinned ends then skip zero inclusion (`needIncludeZero` is guarded by `!fixMM[0]`), the start value, and nice rounding (`coord/axisNiceTicks.js:80-83` skips niceing on a fixed end). Result: every bar chart that has any mark loses its zero baseline (axis [5, …], so the smallest bar draws at zero height) and its nice top tick (37.3 instead of 40). This happens even when the mark sits inside the data range.
- ECharts 6.1 has a purpose-built option, `xxxAxis.dataMin`/`dataMax` (`types/src/coord/axisCommonTypes.d.ts:148-153`: "Data min value to be included in axis extent calculation"). It is merged into the data extent before boundaryGap, zero inclusion and niceing. The probe gives [0,100] for a mark at 95, and [0,40] (unchanged) for a mark at 20.
- An empty-data carrier of `type: "bar"` takes its own bar column. `layout/barGrid.js` `calcBarWidthAndOffset` counts every bar series on the axis by stackId, regardless of data length. Each real bar halves in width (103.5 → 52.1) and shifts off-centre. Histograms, built as a bar series with `barCategoryGap: 0` (`heatmapHistogramOptions.ts:150`), are hit the same way. D5's "carrier type = the chart's own series type" therefore breaks every bar and histogram chart. A `line` carrier does not change the bar layout.

**4. Carrier vs the existing series-count-sensitive passes: two more defects (ground truth in code).**
- `chartOverlayOption.ts:44-45`: `const primary = toSeriesArray(option); if (primary.length !== 1) return option;`. D5 inserts the carrier before `applyChartOverlay`, so any chart that has marks has 2 series and the "vs" overlay is silently dropped. This contradicts the spec ("Lines and bands SHALL coexist with the 'vs' comparison overlay") and the design's own Planner Note.
- `chartAppearance.ts:240` (`applyAxisTriggerTooltip`): `if (toSeriesArray(option).length <= 1) return option;`. A carrier switches every single-series bar/line chart with marks from item tooltip to axis tooltip (`trigger: "axis"`, shadow pointer). That is an unintended behaviour change. `applyHoverEmphasis` (`chartAppearance.ts:263-276`) also applies `focus: "series"` to the carrier, so hovering a data series blurs the marks.

**5. D6 click inertness: TRUE as written; no new guard is needed.** `useChartClickHandler.ts` `handleChartClick` starts with `if (params.componentType !== "series") return;`. ECharts reports a markLine/markArea click as `componentType: "markLine"`/`"markArea"`, so no selection can result. D6 is phrased as an open question. The answer is "already true", and the task should say so: keep the test and drop the "add a guard if needed" branch. Side effect: a mark click falls through to the panel-body "open Customize" handler. This is the same as a grid click, so it is acceptable, but it should be stated.

**6. ADDED vs MODIFIED for `output-routes-api`: defensible against collision, but leaves the canonical spec contradictory.** HEL-1307 exists (`.claude/worktrees/feature/threshold-conditional-formatting/HEL-1307`, already executing: commit 4d11b0ac6). Its delta MODIFIES "Output config writes reject unknown keys per kind" with full replacement text that still says "chart SHALL accept `chartType`, `aggregation`, `chartOptions`, `annotation`". Choosing ADDED avoids a second full-text MODIFIED that would overwrite 1307's key list at archive time. However, once both changes are archived, the canonical requirement still says writes "SHALL accept only top-level keys" from an exhaustive chart list that omits `referenceLines`/`referenceBands`, while the new ADDED requirement says they are accepted. See CR 5.

**7. D9 seam test: not red-first on its invalid half, and does not cross the editor→server seam.**
- Red-first: before the change, every invalid fixture already fails with 400 `Unknown config key … referenceLines`. "400 naming the key" therefore passes before AND after, so the invalid-fixture backend assertions are vacuous (green on main).
- Seam crossing: the frontend half only checks that `buildOutputConfig`'s output is schema-valid. The backend half POSTs the fixture. Nothing ties what the editor emits to what the backend accepts. A schema-valid payload the server rejects would pass both halves. Concrete case: a whitespace-only label passes `minLength: 1` but fails the server's "1-60 chars after trim". The repo's own seam precedent (`frontend/src/features/dashboards/state/layoutCreateSeam.test.ts`) asserts the frontend function's output `toEqual` the shared fixture, which the backend spec then POSTs.
- Internal contradiction: D9 says "every invalid fixture is rejected by [the schemas]", but D3 states `from < to` is not expressible in JSON Schema, and the kind-mismatch case (metric + `referenceLines`) cannot be rejected by a config schema that is not discriminated by kind. A fixture set covering the spec's malformed list cannot satisfy D9 as written.
- Fixture location: the repo convention is `shared-test-fixtures/*.json` (7 existing files, e.g. `OutputSummaryReducerSeamSpec` reads `../shared-test-fixtures/output-summary-reducer.json`; HEL-1307 also uses it). D9 puts the fixture in `frontend/src/utils/`.

**8. Other ground-truth checks: CONFIRMED.**
- Theme tokens `--app-success|warning|error|text-muted` are plain hex in both themes (`theme.css:166,197,198,214` dark; `:250,282-284` light). `resolveChartTheme`/`parseableOr` exist (`chartAppearance.ts:71-100`).
- The public meta resolver returns the whole Output config (`PublicPanelOutputMetaResolver.scala:31-35`).
- The `binCountInvalid` → `saveBlocked` pattern exists (`OutputEditorSheet.tsx:293`).
- HEL-1307's tone words are Good/Warning/Critical (`ConditionalFormatsField.tsx:27-29` in the 1307 worktree), which match D8.
- `KeysDoc` feeds `AssistantProposalToolSchemas.scala:257,398` and `RefinementEditShape.scala:266`.
- helio-mcp `tools/outputs.ts:74-86` repeats the key list.

### Verdict: REFUTE

Category: spec-divergence. The planned render mechanics (D5) would violate the change's own spec (overlay coexistence) and visibly break every bar/histogram chart that has a mark. The planned seam proof (D9) is partly vacuous and contradicts itself. All of this can be fixed in the artifacts; none of it reopens an owner ruling.

### Change Requests

1. **D5, axis extent: replace the `min`/`max` callback functions with the ECharts 6.1 `dataMin`/`dataMax` options** on the value axis (`yAxis`, or `xAxis` for a horizontal bar): `dataMin = min(lowest mark, existing dataMin)`, `dataMax = max(highest mark, existing dataMax)`. Why: the probe above shows the callbacks pin both ends, which removes the zero baseline and nice ticks on every chart that has any mark (`[5,37.3]` vs `[0,40]`). `dataMin`/`dataMax` gives `[0,100]` for a mark at 95 and leaves `[0,40]` unchanged for a mark at 20. Update the D5 bullet, the "Axis extent functions" risk line, and task 5.3 to assert: (a) a bar chart with a mark inside the data range has an extent identical to the no-mark extent; (b) a mark above the data widens the extent with zero still included.

2. **D5, carrier series: the carrier must not be a bar series, and it must be invisible to every series-count-sensitive pass.** Specify all of the following, each with a unit test in 5.3:
   (a) The carrier is `type: "line"` (or another type that is not counted in bar layout) on every supported chart type, or it shares the primary's stack. An empty bar carrier halves bar width (probe: 103.5 → 52.1 px; `barGrid.js` `calcBarWidthAndOffset`). This includes histograms.
   (b) The "vs" overlay is still drawn when marks are present. `applyChartOverlay` returns unchanged when `toSeriesArray(option).length !== 1` (`chartOverlayOption.ts:45`), so either add the carrier after the overlay, or make the overlay count exclude the carrier id. Pick one and state it.
   (c) A single-series bar/line chart that has marks keeps its item tooltip. `applyAxisTriggerTooltip` counts series (`chartAppearance.ts:240`).
   (d) Hover-emphasis `focus: "series"` does not blur the marks (exclude the carrier from `applyHoverEmphasis`, or set the carrier's `emphasis.disabled`/`blur` handling).
   Re-derive the pass order in D5 from these constraints. The current "BEFORE `applyChartOverlay`" placement is the root of (b) and (c). Also extend the "fall back to series[0]" escape hatch's trigger list to cover these four checks, not only legend behaviour.

3. **D9, make the seam test real and red-first.**
   (a) The frontend half asserts that the editor's emitted config, i.e. `buildOutputConfig` (and the `configPatch` PATCH body) for the filled-in state, `toEqual` the fixture's valid config. The backend then POSTs/PATCHes exactly that payload. This follows the `layoutCreateSeam.test.ts` pattern.
   (b) Backend invalid-fixture assertions match the problem-specific message (e.g. `at most 5`, `from must be less than to`, `tone must be one of`), not just the key name. Each assertion is then red on main, where every case returns the generic `Unknown config key` 400. Record that red output in evidence.
   (c) Partition the invalid fixtures into `schemaRejects` (shape, caps, tone enum, label length, extra item key, string value) and `serverOnly` (`from >= to`, kind mismatch, whitespace-only label). Only the first group is asserted against the three schemas, which removes the D3/D9 contradiction.
   (d) Every invalid fixture item is also dropped by `sanitizeReferenceMarks`, so the frontend reader agrees with the server.
   (e) Move the fixture to `shared-test-fixtures/chart-reference-marks.json`, matching the repo convention and HEL-1307.

4. **D1/D3, define label trim semantics consistently across server, schema and editor.**
   - D1 says "1-60 chars after trim" but does not say whether the server stores the trimmed or the raw string.
   - D3's schema `minLength: 1`/`maxLength: 60` counts raw characters. A 58-character label with 4 surrounding spaces is rejected by the schema but accepted by the server, and a whitespace-only label is the reverse.
   - Pick one rule and state it in D1, D3, D8 and the output-routes-api spec. Recommended: the editor trims before emitting, the server rejects a label whose raw length is outside 1..60 or whose trimmed form is empty, and the schema adds `pattern: "\\S"`.
   - The same paragraph should state that the editor blocks a non-finite value (e.g. `1e400` parses to `Infinity`, which `JSON.stringify` sends as `null`).

5. **Spec delta for `output-routes-api`: the archived canonical spec must not keep an exhaustive chart key list that omits the new keys.** Keep the ADDED validation requirement, and add a task to the PR re-sync step (the Risks bullet already plans a re-sync with origin/main). Once HEL-1307 has merged, add a MODIFIED delta of "Output config writes reject unknown keys per kind", copied from the post-1307 canonical text, whose chart clause adds `referenceLines`, `referenceBands`. If HEL-1307 has not merged by then, state explicitly in the delta why ADDED alone is used and file the reconciliation on whichever change archives second. Either way, the archived spec must not contradict itself.

6. **D5 style vs the "vs" overlay: make a neutral reference line distinguishable from the overlay.** The line overlay is `lineStyle: {type: "dashed", color: textMuted, width: 2}` (`chartOverlayOption.ts` overlaySeries). D5's neutral reference line is `dashed`, `textMuted`, 1.5px, which is effectively the same mark. The spec requires the two to coexist, so on a line chart with both, the reader cannot tell the target from the comparison. Specify a different dash pattern (e.g. `dotted` or `[6,3]` against the overlay's default dash) or another distinguishing treatment, and include this case in the 5.5 running-app screenshots.

7. **D9 GUARD mechanism: state how a Jest/Scala test reads the other side's constants.** As written, "backend constants, frontend constants and every schema agree" names no mechanism; Jest cannot import Scala. Recommended: the shared fixture holds `{maxLines, maxBands, maxLabel, tones}`; `ChartReferenceMarksSpec` asserts the Scala constants equal it; a Jest test asserts the TS constants equal it and walks the three schemas (asserting 3 found) for `maxItems`/`maxLength`/`enum`. Each side is mutation-proven.

### Non-blocking notes

- D6: rewrite it as a statement ("already inert: `useChartClickHandler` returns on `componentType !== "series"`; a mark click falls through to the panel-body handler like a grid click") and keep task 3.5 as a test-only task. Consider `markLine.silent: true`/`markArea.silent: true` (series-level `silent` does not cover markers) so marks show no hover cursor or emphasis.
- `legend.data` is already set explicitly by every non-pie data option (`chartDataOptions.ts:104,161,179,198`), so the carrier is excluded from the legend as long as it has no name that gets appended. D5's "set legend.data" step may be a no-op. Verify it rather than add code.
- HEL-1307 touches `useOutputKindState`, `buildOutputConfig`, `configPatch`, `OutputPreviewPane`, `OutputSheetPreviewCard`, the three schemas and `helio-mcp/src/tools/outputs.ts`. Expect conflicts in all of them, not just the backend files listed in Risks.
- The planning artifacts were untracked at review time, so `head_sha` is the base commit b3a7efc9.

### Probe (verbatim, self-authenticating)
`probe.cjs` (run as `node probe.cjs <worktree>/frontend/node_modules/echarts`; sha256 ba09b7b4…07cd5):
```js
const echarts = require(process.argv[2]);
function run(label, yAxisExtra, extraSeries) {
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 600, height: 400 });
  chart.setOption({
    animation: false,
    xAxis: { type: 'category', data: ['a','b','c'] },
    yAxis: Object.assign({ type: 'value' }, yAxisExtra),
    series: [{ type: 'bar', name: 'amount', data: [5, 8, 37.3] }].concat(extraSeries || []),
  });
  const y = chart.getModel().getComponent('yAxis').axis.scale.getExtent();
  const s0 = chart.getModel().getSeriesByIndex(0).getData().getItemLayout(0);
  console.log(label.padEnd(44), 'yExtent=', JSON.stringify(y), 'bar0 width=', s0 && s0.width.toFixed(1), 'x=', s0 && s0.x.toFixed(1));
  chart.dispose();
}
run('baseline', {});
run('D5 min/max fns, mark=20 (inside data)', { min: ({min}) => Math.min(min, 20), max: ({max}) => Math.max(max, 20) });
run('D5 min/max fns, mark=95 (above data)', { min: ({min}) => Math.min(min, 95), max: ({max}) => Math.max(max, 95) });
run('6.1 dataMin/dataMax, mark=95', { dataMin: 95, dataMax: 95 });
run('6.1 dataMax only, mark=20', { dataMax: 20 });
run('empty bar carrier w/ markLine', {}, [{ type: 'bar', id: '__c', data: [], silent: true, markLine: { data: [{ yAxis: 20 }] } }]);
run('empty line carrier w/ markLine', {}, [{ type: 'line', id: '__c', data: [], silent: true, markLine: { data: [{ yAxis: 20 }] } }]);
run('no extent fix, markLine 95 on series', {}, [{ type: 'line', id: '__c', data: [], markLine: { data: [{ yAxis: 95 }] } }]);
```
