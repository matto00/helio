## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 9415a44eca125f5bee25bdd4878911d39b6ecc37 (= main; change dir untracked). Spawn-cwd guard: READY.

### What I verified (with evidence)

**D5 blocker list vs the real overlay rules**
- `selectChartOverlay` (`frontend/src/features/panels/history/chartOverlay.ts:34-63`) requires a non-null compare that matches the history's compare, no filter, `rowsTruncated === false`, a baseline series that is not downsampled and is in `rows` mode with `x/y === fieldMapping.xAxis/yAxis` (both `typeof string`), and no repeated x on either side. It does not read `aggregation` itself. Aggregation is ruled out on the server: `OutputSummaryReducer.series` (`backend/.../history/OutputSummaryReducer.scala:108-123`) returns a `grouped` series when groupBy, agg and yField are all set and Output `chartType != "scatter"`. Otherwise it returns `rows` when xAxis/yAxis are mapped, and `JsNull` when they are not.
- `applyChartOverlay` (`frontend/src/features/panels/ui/chartOverlayOption.ts:28-57`) requires line/bar, rejects `bar.stacking === "normalized"` and `bar.orientation === "horizontal"`, a non-category x axis, and more than one primary series. I confirmed that the `chartOptions` it receives is the **Output's** `config.chartOptions`: `ChartOutputPanel.tsx:62-70` passes `cfg.chartOptions` from `readChartConfig(config)` to `buildChartOption.ts:186`. The chart kind comes from `appearance.chart.chartType` (`buildChartOption.ts:97-100`). So D5 correctly reads bar options from the Output config and never reads `config.chartType`. This matches the owner ruling.
- Multi-series: `buildDataOptionCore` (`chartDataOptions.ts`) splits line/bar into one series per distinct `fieldMapping.series` value, via `resolveDataColumns`' `fieldMapping.series` (`utils/chartClickSelection.ts:23-35`). The `series` blocker is the right Output-level proxy.
- Unmapped: the editor's `chartFieldMapping` is read-only state (`OutputEditorSheet.tsx:209`) and no chart x/y mapping UI exists. `grep xAxis` over `features/pipelines/ui` and `features/panels/ui/editors` finds only `HistoryChart.tsx`. So `unmapped` is a real, honest Output-level fact. It applies to every editor-created chart Output and to aggregate-tail Outputs (`fieldMapping: {category, value}`, `buildOutputConfig.ts` tail branch).
- Conclusion: every D5 blocker really does prevent the overlay in the normal case. The list is a slightly **conservative superset**, not literally "exactly" the runtime rules; see the non-blocking notes. This is consistent with the existing spec `openspec/specs/chart-history-overlay/spec.md:24`, which says "a chart Output with `config.aggregation` set SHALL get no dashboard overlay".

**D3 "Previous" vs the "no previous-run copy" constraint**
- `METRIC_COMPARE_OPTIONS` (`OutputKindFields.tsx:180-186`) already contains `{previous_run, "Previous"}`. `compareOptions` only appends `custom:` values today (`:188-192`).
- D3 drops "Previous" from the chart base list. It shows it only when a stored `previous_run` already exists, which the owner ruling requires ("a compare value set earlier stays visible and clearable"). It reuses the existing label verbatim and adds no new string. That satisfies C1, the ticket's "No 'previous run' copy", and the driver's "don't extend" rule. The D6 copy contains no "previous". The spec delta encodes this restriction.

**D4 compare round-trip on chart save**
- The chart branch of `buildOutputConfig.ts` currently omits `compare`. The server merge (`OutputService.mergeConfig:469-477`) is shallow except for allow-listed sub-objects, so an explicit `null` overwrites and an omitted key keeps the old value.
- `readMetricConfig` already reads `compare` kind-agnostically (`outputConfigTypes.ts:271`), so initialising shared state from the stored value preserves an untouched value.
- `OutputCompare.validateConfig` is kind-agnostic (`OutputService.scala:462`, `PipelineService.scala:680`), so no new validation path is needed. This matches the driver constraint.
- The existing requirement `metric-history-delta-ui/spec.md`, "Saving any Output kind SHALL preserve an existing config.compare the editor does not change" (scenario "Chart save keeps compare"), still holds under D4. No modifying delta is needed.
- The test being replaced (`OutputEditorSheet.compare.test.tsx:118`) asserts the old omission. Replacing it is a legitimate spec change, not a fixture patch, because the ticket's AC changes the behaviour.

**D8 e2e achievability**
- The helpers exist: `e2e/support/isolateLivePage.ts` (`loginThenIsolate`) and `e2e/support/historySeed.ts` (`backdateHistory(outputId, userId, interval, expectedRows)`).
- `e2e/hel1275-metric-delta-sparkline.spec.ts:166-182` is the exact precedent: run, backdate 1 row by "7 days 1 hour", run again, choose "7 days" through `getByRole("combobox", {name: "Compare"})`, and prove no reload (HEL-1327 pattern, `:289-294`).
- `e2e/hel1277-output-history-scrubber.spec.ts:210-330` is the precedent for API-creating a raw-rows line chart Output (`fieldMapping: {xAxis, yAxis}`), placing it with `auto-layout` h:5, and detecting the overlay.
- `historySeed.ts` and the existing specs are not touched by this change, so the e2e can be built from these helpers.

**AC/scope coverage**
- AC1 (picker on chart Outputs, help text listing every case) is covered by D1, D6 and tasks 1.5 and 2.2. The owner ruling replaced "hide for kinds that can never overlay" with "never hide".
- AC2 (no previous-run copy) is covered by D3, D6 and the spec delta.
- AC3 (RTL, e2e, both themes) is covered by D8 and tasks 1.6, 2.1-2.4.
- Driver constraints: no backend change, existing validation reused, HEL-1351 not attempted, no ci.yml or playwright.config.ts edits, ≤2 workers and `nice` recorded in D8 and 2.4.
- No placeholders or TBDs. No schema or API delta is needed (frontend only; `config.compare` already exists in the contract).
- `Select` supports `ariaDescribedBy` (`shared/ui/Select.tsx:32`), so D6's association is implementable. `output-editor-sheet__field-hint` and `__type-hint` exist and are tokenised (`OutputEditorSheet.css:58-68`), so D6's "existing classes only" holds.

### Verdict: CONFIRM

### Non-blocking notes (the executor should take these as guidance)
1. **D8 overlay assertion mechanism.** The dashboard chart renders on a canvas, so the legend text is not in the DOM. "Assert the chart legend contains 'vs 7d'" must use the hel1277 technique: hover the canvas until the axis-trigger tooltip (DOM) lists `vs 7d` (`hel1277-output-history-scrubber.spec.ts:309-321`). Keep the h:5 auto-layout so the panel is not compact. A DOM `getByText("vs 7d")` on the legend will never pass.
2. **D8 ordering.** `backdateHistory` shifts *every* history row of the Output and asserts `expectedRows`. Call it after run 1 (expectedRows 1) and before run 2, as hel1275 does, not after both runs.
3. **D5 is a conservative superset, not "exactly".**
   - `aggregated` triggers on any non-null `aggregation` object. The server only groups when groupBy, agg and yField are complete *and* Output `chartType != "scatter"`.
   - `series` triggers even when the series column has one distinct value, or names a column that is not present.
   - Neither difference is harmful (the existing spec already says aggregated means no overlay), but the design's word "exactly" overstates it.
   - One UX edge to handle: `buildOutputConfig` writes leftover aggregation state even when `chartType === "scatter"`. The sheet then says "Aggregation isn't available for scatter" (`OutputKindFields.tsx:90-96`) while the note says "This Output aggregates its rows". Consider whether the note should be suppressed there, or the wording kept consistent. Do not resolve it by reading `chartType` for the bar blockers.
4. **Help-text omission.** A repeated x value on either side also suppresses the overlay (`chartOverlay.ts` `hasRepeatedX`; existing spec line 24). The owner's fixed list does not include it, and the design follows the owner's list. Optionally mention it; do not treat it as required.
5. **The `unmapped` note will appear on every editor-created chart Output with compare set**, because the editor has no x/y mapping UI. The note is honest, but it names a fix the user cannot make in this editor. Phrase it so it does not imply a control exists. For example, avoid "map your x and y fields".
6. File-size: `OutputEditorSheet.tsx` is already 682 lines (over the ~400 soft budget). Keep the additions there minimal. Put the picker and notes in `OutputKindFields.tsx` or an extracted `CompareField`, as D7 allows.
