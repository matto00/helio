## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed: worktree HEAD 3eb0cc893c19f3c9306347783a4787ab22d6c961 (the change dir is untracked). Artifacts reviewed:
ticket.md (owner rulings 1-5, treated as settled), proposal.md, design.md, tasks.md, both spec deltas, and the
round-1 report. Every check below was re-derived from the source tree. The revision's own claims were not taken
on trust.

### What I verified (with evidence)

**Round-1 change requests: are they resolved?**

- **CR1 (gap tooltip reads "0"/"undefined"): resolved.**
  - D7a wraps the appearance tooltip `valueFormatter` (`utils/chartAppearance.ts:199`, today `formatChartNumber`).
    For null/undefined it renders a no-value mark. `formatChartNumber` stays unchanged for axis labels
    (`:221`) and reference marks (`referenceMarksOption.ts:109`).
  - The time-axis formatter reuses the same wrapper.
  - The required red-first tests are named in D11(l) and task 3.1a. The spec delta has a "Hovering a gap"
    scenario. D12 screenshots a hovered gap. The C2 side effect (overlay nulls) is stated.
  - **Regression check (new probe).** Does the "non-finite -> no-value" wrapper break today's scatter tooltip? I
    probed what value a scatter item-tooltip fragment carries in ECharts 6.1.0, on category, time and time+size
    axes (`evidence/skeptic-design-2-probe-scatter-valueformatter.cjs`, output in
    `evidence/skeptic-design-2-probe-scatter-output.txt`). Every case reports `value: 2` (the y only, never the
    `[x, y]` array), so the wrapper cannot turn a scatter tooltip into a dash.
  - Heatmap has its own tooltip `formatter` (`heatmapHistogramOptions.ts:84-88`), which bypasses
    `valueFormatter`.
  - `UsageChart.tsx:65-70` overrides `valueFormatter` itself, so it is unaffected.
- **CR2 (preview and history wiring): resolved.**
  - D1 now wires all three `ChartRenderer` callers and names the exact source for each. I confirmed the callers
    with a grep of `<ChartRenderer` / `useChartOption(` / `buildChartOption(` outside tests: only
    `ChartOutputPanel`, `OutputPreviewPane` and `HistoryChart`.
  - Both type sources use the same vocabulary. `OutputProtocol.scala:194` and
    `PublicPanelOutputMetaResolver.scala:36` emit `DataFieldType.asString`. Capability columns go through
    `wireType` → `DataFieldType.asString` (`PanelCapabilityService.scala` ~82). `TimestampType` maps to
    `"timestamp"`, and `"date"` is canonicalised to `"timestamp"` (`model.scala:431,452`).
  - `HistoryChart.tsx:62-66` plots `headers=[series.x, series.y]`, so keying on `series.x` is correct.
  - Server-side aggregate tails keep the groupBy type. `buildOutputConfig.ts` ~238 copies the capability
    `dataType` into the aggregate step's `groupBy[].type`, so the editor preview (client grouping) and the saved
    dashboard (server tail) agree on the axis type.
- **CR3 (how the aggregate learns its groupBy): resolved.**
  - `GroupedAggregate` gains `groupBy?`. It is set at the two sites that already add `seriesName`
    (`OutputPreviewPane.tsx:101-104`, `ChartOutputPanel.tsx` ~109-119). `buildAggregateDataOption` receives
    `fieldTypes` + `chartOptions`.
  - `HistoryChart` never passes `chartAggregate`, so no third site is missing.
- **CR4 (fixture boundary cases): resolved.** I checked every added case against `TimestampParsing.scala:46-81`:
  - `"1759276800.0"` and `"1.7592768E9"`: `toLong` fails, then `BigDecimal` is whole, giving epoch seconds.
  - `"-9999999999"`: not `< -9999999999`, so it is read as seconds.
  - `"-10000000000"`: read as millis.
  - `"1759276800.5"`: not whole, and `parseNonEpochInstant` rejects it, so `None`.
  - Whitespace: the epoch path calls `s.trim`, and `parseInstant` trims before the non-epoch parsers.
  - The decision to mirror the backend for each shape is stated, and `MM/dd/yyyy` is the single marked
    extension (`backendParseInstant: false`).
  - Precedent: `shared-test-fixtures/` and Scala specs that read it already exist
    (`ComputeExpressionFunctionsSeamSpec`, `ChartReferenceMarksSpec`).
- **CR5 (auto-detect branch): resolved.** D2 puts the no-y-mapping auto-detect branch (`chartDataOptions.ts:184-200`)
  on the time axis and keeps its NaN→0 semantics. The test is named in D11(i2) and task 3.2.

**Did the revision introduce new defects?**

- `buildChartOption.ts:180-189` merge order and `applyAxisTriggerTooltip` (`chartAppearance.ts:255-268`): the
  latter spreads the existing tooltip, so a D7 time-axis `formatter` survives the switch to the axis trigger.
  An applied overlay makes the series count >1, so the D7 formatter must handle the axis-trigger params array.
  D7 already says "item and axis tooltips".
- `toPercentShares` (`chartTypeOptions.ts:55-76`) and the horizontal swap (`:101-106`) are unchanged by the
  revision. D5's pair-item read/write requirement still covers them.
- No placeholders and no TODO/TBD. Proposal, design, tasks and spec deltas do not contradict each other.
- AC coverage holds:
  - AC1: D2/D4/D11c + D12 pixel measurement.
  - AC2: D5/D11a,b.
  - AC3: D11d/C2/task 3.9.

### Verdict: CONFIRM

All five round-1 change requests are resolved against ground truth, and the revision introduced no blocking
defect. The notes below are polish an implementer can absorb.

### Non-blocking notes

1. **No-value mark: prefer `—` (em dash) over `-`.** The app's existing no-value rendering is `—` throughout,
   including the one chart that already handles tooltip gaps:
   - `UsageChart.tsx:69`: `typeof v === "number" ? … : "—"`
   - the shared `DataGrid.tsx:410`
   - `DatasetRowGrid.tsx:463`
   - `adminUsage/format.ts`

   A dashboard showing `—` for a null table cell next to `-` for a null chart point is a small inconsistency.
   DESIGN.md has no written rule on this, so it is not a REFUTE. If the orchestrator agrees, fold the one-character
   change into design D7a, the spec delta's gap requirement/scenario and task 3.1a before execution. Otherwise
   the executor is bound to `-`.
2. **D7's rationale is factually wrong but harmless.** It says the existing `valueFormatter` "would receive the
   `[t, y]` array". The r2 probe shows ECharts hands the formatter the y value only, on time axes too. The custom
   time-axis `formatter` is still needed for ruling 4's UTC header, so the decision stands. Only the reason is
   wrong.
3. **The existing `escapeHtml` helper.** `heatmapHistogramOptions.ts:88` already escapes tooltip text. D7's
   "small local escape helper" should reuse or co-locate with it rather than add a third copy.
4. **`OutputSheetPreviewCard.tsx` sits between `OutputEditorSheet` and `OutputPreviewPane`.** It must thread
   `fieldTypes` too. Add it to proposal Impact / files-modified.
5. **`buildDataOption` needs `fieldTypes` + bar orientation.** Today it receives only scatter/histogram options.
   Task 3.2 implies this but does not say it. The horizontal-bar exclusion (D2) needs `chartOptions.bar.orientation`
   at that point.
6. **Multi-series on a time axis: key the lookup by instant, not the raw x string.** D5 builds the shared x list
   from distinct parsed instants. `lookup` (today keyed by raw x, `chartDataOptions.ts:150-157`) must then be keyed
   by instant as well, or two spellings of one instant (`2026-10-01` vs `2026-10-01T00:00:00Z`) give a false gap.
   Also state which raw string becomes the item `name` (first-seen), since click filtering matches it literally.
7. **Fixture gaps.** These Java-ISO shapes are not yet in the fixture: case-insensitive `t`/`z`
   (`ISO_LOCAL_DATE_TIME`/`ISO_INSTANT` parse case-insensitively), a leading `+` on a numeric epoch string
   (`toLong`/`BigDecimal` accept it), and an offset date-time without seconds. Add them if cheap, so "mirrors
   exactly" is pinned rather than asserted. `looksLikeTimestamp` accepts zoned `[Region/Id]` strings that
   `parseInstant` rejects. Those rows would be dropped from a time chart, which matches the backend and is
   acceptable.
8. **A Risks bullet contradicts D1.** "[fieldTypes not in scope at a call site] -> that site keeps today's category
   behaviour" reads as a standing escape hatch, while D1 now requires every site wired. Reword it to "only with a
   ground-truth reason stated in the PR body".
9. **C2 deep-equal tests and the D7a wrapper.** Once the wrapper exists, an option compared to main's literal
   object differs by `valueFormatter` function identity. Use `expect.any(Function)` or compare against an option
   built through the same module.
