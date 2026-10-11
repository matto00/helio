## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed: worktree HEAD 3eb0cc893c19f3c9306347783a4787ab22d6c961 (main; change dir untracked), artifacts
ticket.md, proposal.md, design.md, tasks.md, specs/chart-field-data-rendering/spec.md,
specs/chart-history-overlay/spec.md, plus `.concertino/runs/HEL-1305/evidence/premise-validation.md`.

### What I verified (with evidence)

- **Merge override (D6) is real.** `buildChartOption.ts` builds `xAxis: {...dataOption.xAxis, ...appearanceOption.xAxis, ...}`
  and `chartAppearance.ts:206` sets `type: "category"`, so a data-builder time axis is clobbered today. D6 names it. OK.
- **Multi-series zero-fill (ruling 2).** `chartDataOptions.ts` multi-series branch: `allX` first-seen order,
  `lookup[g]?.[x] ?? 0`. D5 targets it. OK.
- **ECharts 6.1.0 stacking on a time axis** (probe, `evidence/skeptic-design-1-probe-echarts-null-tooltip.cjs`, output in
  `evidence/skeptic-design-1-probe-output.txt`): two stacked bar series with `[t,y]` data on `xAxis.type: "time"` report
  `isStackedByIndex: true`; stacked values `[11, NaN]` (null omitted). So D5's "identical, sorted, equal-length x lists
  in every series" is necessary and sufficient. The design's risk note is right; no fallback should be needed.
- **Click params on a time axis**: `data.getName(i)` returns the `{name}` raw x (`2026-10-02`), so D4's keep-`params.name`
  click keying works.
- **Axis-pointer shadow on a time axis**: `getBandWidth()` is 1 px on time vs 150 on category, BUT ECharts 6
  `calcAxisPointerShadowBandWidth` uses `calcBandWidth(..., fromStat: series)` (viewHelper.js:197), so the shadow width
  comes from the bar series. Not a defect; the running-app check (D12) covers it.
- **Tooltip value for a null point** (same probe): on a category axis, `seriesModel.formatTooltip(nullIndex, true)`
  yields fragment `value: undefined`; on a time axis with `{value:[t,null]}` it yields `null`. ECharts then calls
  `valueFormatter(fragment.value)` (tooltipMarkup.js:192). The appearance tooltip's `valueFormatter` is
  `formatChartNumber` (`chartAppearance.ts:133-136`): `Number(undefined)` is NaN, so it returns the string
  `"undefined"`; `Number(null)` is 0, so it returns `"0"`. See Change Request 1.
- **Call sites.** `ChartRenderer` has exactly three callers: `ChartOutputPanel` (via `OutputPanelContent`, which has
  `output.schema`; `PublicOutputMeta.schema` exists on the public path), `OutputPreviewPane`, and `HistoryChart`.
  `HistoryChart` receives `output: Output`, and `Output.schema` is defined in `types/output.ts:46`. The editor sheet
  holds `capabilities.columns[]` (`{name, dataType}`, `OutputEditorSheet.tsx:121-134`). Those columns are built from
  `SchemaField(c.name, c.dataType)` (`PanelCapabilityService.scala:96`), so they use the same type vocabulary. See CR 2.
- **Aggregate path.** `GroupedAggregate` is `{categories, values, seriesName?}` (`utils/aggregate.ts`). It has no
  `groupBy`, and `buildChartOption` gets no `aggregationSpec` (only `ChartRenderer` gets it, for clicks). See CR 3.
- **Overlay.** `applyChartOverlay` bails unless `xAxis.type === "category"`. `selectChartOverlay` only checks
  field-name equality and string-level `hasRepeatedX`, and its eligibility is axis-agnostic. D9's
  instant-alignment change is sufficient.
- **Reference marks.** `referenceMarksOption.ts` widens the value axis via `dataMin`/`dataMax` and its carrier series
  has `data: []`. Neither reads the x data, so D10's "no code change" claim is plausible and pinned by a guard test
  plus D12.
- **`toPercentShares`** (`chartTypeOptions.ts:55-76`) reads `Number(s.data[i])`. `Number(null) === 0`, so today a
  ruling-2 `null` would become a 0% bar, not "no bar". D5 explicitly requires null to stay null. OK.
- **Backend parser** (`TimestampParsing.scala`). `parseInstant` reads a whole-number epoch first. It accepts a Long,
  or a numeric string via `s.trim.toLong` or a whole `BigDecimal(s.trim)` (so `"1759276800.0"` and `"1.7592768E9"`
  are accepted). The millis threshold is symmetric (`epoch < -9999999999` is also millis). If no epoch matches, it
  tries `Instant.parse`, `OffsetDateTime.parse`, `ISO_LOCAL_DATE_TIME` as UTC, space-separated with a 0-9 digit
  fraction as UTC, and finally `LocalDate` as midnight UTC, all on the trimmed string. `MM/dd/yyyy` is in
  `looksLikeTimestamp` only. D3's description is accurate, but its fixture case list misses some of these shapes.
  See CR 4.
- **Escaping.** D7 requires escaping the series name and raw x in the string formatter, with a `<b>` test. ECharts'
  own default markup `encodeHTML`s values (tooltipMarkup.js:244), but a custom string formatter bypasses that. The
  requirement is correct.
- No TODO/TBD placeholders. The proposal, design, tasks and spec deltas do not contradict each other. All three
  ACs are covered: AC1 by D2/D4/D11c + D12 pixel measurement; AC2 by D5/D11a,b; AC3 by D11d/C2.

### Verdict: REFUTE

The design is close and mostly well grounded. Two defects block it: the design as written would ship ruling 2's
gaps with a tooltip that reads `0` or `undefined` (CR 1), and it leaves two required call sites optional when
ground truth shows the data is in scope (CR 2). Three ambiguities also need closing (CR 3-5).

### Change Requests

1. **A gap's tooltip must not read "0" or "undefined" (ruling 2, both axis types).** Probe-confirmed on ECharts 6.1.0
   (`evidence/skeptic-design-1-probe-output.txt`):
   - On a category axis, an axis-trigger tooltip passes `undefined` for a `null` point to the appearance `valueFormatter`.
     `formatChartNumber` (`utils/chartAppearance.ts:133-136`) renders that as `"undefined"`.
   - D7's time-axis formatter sends y "through `formatChartNumber`", and `formatChartNumber(null)` returns `"0"`.
     That brings back the "reads as a real zero" defect the ticket exists to remove.

   Amend D5/D7 so a null/undefined value renders as an explicit no-value mark (e.g. ECharts' own `-`, or omit the
   row). Two places need it:
   - in the tooltip `valueFormatter` used on category axes
   - in the D7 time-axis formatter

   Add red-first unit tests (in D11 and tasks 3.1/3.3):
   - (a) category multi-series: the `valueFormatter` output for the gap value is not `"0"`/`"undefined"`
   - (b) the time-axis formatter with `[t, null]` likewise

   D12 must screenshot a hovered gap. Note this also changes today's rendering of a "vs" overlay's unmatched (null)
   points. That is a correct side effect but must be stated, because C2 promises unchanged non-timestamp options
   (the formatter function's behaviour changes, not the option shape).

2. **Make the `OutputPreviewPane` and `HistoryChart` wiring definite (D1, task 2.2).** Ground truth removes the
   "if in scope" hedge:
   - `HistoryChart` already receives `output: Output` with `schema`.
   - The editor sheet holds `capabilities.columns[].dataType` for the selected node, built from the same
     `SchemaField` type vocabulary (`PanelCapabilityService.scala:96`).

   Leaving the preview unwired means the editor previews a timestamp chart as an evenly spaced category axis while
   the saved dashboard shows a time axis. `OutputPreviewPane`'s own header says it exists so the two render
   identically. Name these exact sources in D1, require both sites wired, and drop the "leave it absent" escape.
   The only acceptable exception is one stated with a ground-truth reason. For `HistoryChart`, state which field is
   looked up (`series.x`) and that a grouped-mode series' x is the `groupBy` field.

3. **Specify how the aggregate path learns its `groupBy` (D2, D8).** `GroupedAggregate` carries no `groupBy`, and
   `buildChartOption` receives no aggregation spec. D2's "or the aggregation's `groupBy` for the aggregate path" has
   no data path today. Decide one mechanism. For example: `ChartOutputPanel` and `OutputPreviewPane` add `groupBy`
   to the `chartAggregate` object they already decorate with `seriesName`, and `buildAggregateDataOption` receives
   `fieldTypes`. Name it in D8 and task 3.4.

4. **Widen the D3 parity fixture to the backend's real accepted set.** D3 claims the frontend parser accepts
   "exactly" `parseInstant`'s set, and the shared fixture is the only GUARD on that. Add cases for these shapes,
   each with `backendParseInstant: true` and its expected millis (or null), so the guard pins the boundary rather
   than the happy path:
   - whole-number decimal and scientific numeric strings (`"1759276800.0"`, `"1.7592768E9"`)
   - a negative epoch, including the negative millis threshold
   - surrounding whitespace (the backend trims)
   - a non-whole decimal (`"1759276800.5"`, which the epoch path must reject and which then parses as nothing)
   - an ISO instant with a fraction and `Z`
   - `T`-separated with and without seconds

   Separately, decide and state whether the TS parser mirrors the backend for each of these shapes or deliberately
   rejects it.

5. **State the auto-detect branch's axis (D2/D4, task 3.2).** The spec delta says any `line` or vertical `bar` chart
   whose x is `timestamp` "SHALL render a continuous time x axis", with no exception. The design adds the time
   branch beside "the existing branches", and task 3.2 lists line / vertical bar / scatter / multi-series. Neither
   says whether the no-y-mapping auto-detect branch (`chartDataOptions.ts`, the last branch of `buildDataOptionCore`)
   gets a time axis. Either include it (with a test) or add an explicit exception to the spec delta and Non-Goals.

### Non-blocking notes

- `chartTimeAxis.ts` is specified echarts-free, but D7 suggests `echarts.format.encodeHTML`. Do the escaping in the
  builder, which already imports from echarts, or with a local escape helper, so the module stays importable from
  the main bundle (HEL-512 lazy-chunk rule).
- D7's "every plotted x is midnight UTC" decides the tooltip format. Compute it over the primary plotted instants
  only, so an overlay never flips the format.
- The D12 running-app check should include a stacked (not just normalized) multi-series bar on a time axis. The
  stacking probe above says it works by index. Confirm it visually rather than relying on the Risks fallback.
- The follow-up candidates (single-series NaN to 0, dropped-row count, axis override) are reasonable to file at
  Delivery.
