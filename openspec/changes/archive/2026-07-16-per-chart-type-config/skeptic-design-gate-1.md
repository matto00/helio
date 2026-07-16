## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

1. **Ticket session directives cross-checked against real precedent files.**
   - `V55__panel_table_display_config.sql` (read in full) confirms the HEL-255 pattern: nullable
     column(s), NULL = default, doc comment referencing the prior migration. `V56` (design D1/Migration
     Plan) follows the same shape.
   - `ChartPanel.scala` (read in full) confirms today's `ChartPanelConfig` has `aggregation:
     Option[JsObject]` (untyped JSONB blob) — design's proposal to instead use *typed* Scala case
     classes (`LineOptions`/`BarOptions`/…) is a deliberate, disclosed choice (D2), not a
     misrepresentation of precedent.
   - `PanelRowMapper.scala` (read in full): confirmed the exact "two-arm" bug class the ticket warns
     about — `chartConfig` (read) and the `ChartPanel` case inside `domainToRow` (write) are two
     separate code paths that must both be touched. Task 1.4 names both explicitly.
   - `TablePanel.scala` Patch/decode (grepped): confirmed the exact lenient-decode / strict-Patch
     asymmetry (`deserializationError` only on the Patch path, via `RequestValidation.validateTableDensity`)
     that D2/task 1.3 proposes to mirror for `orientation`/`stacking`/`barGapPct`/`donutHolePct`.
   - `PanelRepository.scala` (grepped): confirmed panels are already past the 22-tuple ceiling and use
     a Slick `HList` (line 329-335) — task 1.5's "HList past 22-col ceiling" claim is accurate, and
     adding one more column is a mechanical extension of an already-established pattern.
   - `schemas/panel.schema.json` `ChartConfig`/`ChartAggregation` `$defs` (read): confirms current wire
     shape design builds on top of, with room for a new `chartOptions` key.

2. **Frontend editor precedent (HEL-255) read in full** — `useTableDisplayState.ts` (174 lines) and
   `TableDisplayFields.tsx` (114 lines): confirmed dirty-tracking/reset/patch-merge pattern the design
   proposes to mirror exactly for `useChartDisplayState`/`ChartDisplayFields`.
   - `BindingEditor.tsx` is **exactly 400 lines** today (`wc -l` = 400) — the ticket's claim that it
     "sits at the 400-line threshold" is literally true right now, validating D5's split requirement.
   - `PanelDetailModal.tsx` (read lines 230-360): confirmed `chartAppearance` state (line 104) is owned
     by the modal and is in scope before `renderSubtypeEditor()` is called, and both the appearance
     PATCH (`accumulatePanelUpdate`) and the subtype editor's `save()` are dispatched in the same
     `handleEditSubmit` (lines 204-229) — validates D3's "PanelDetailModal passes `chartType` down" and
     the Risks section's "both already ride the same Save flow" claim.
   - `panelSlots.ts` (grepped): confirmed `chart` fieldMapping slots are `xAxis`/`yAxis`/`series` —
     validates the Planner Notes' claim that ticket's "Line: x-axis field", "Pie: slice/value field",
     "Scatter: x/y field" are already served by existing binding infra and correctly excluded from
     `chartOptions` to avoid duplication.
   - `ChartPanel.tsx` (read in full, 249 lines): confirmed the pie case already reads `xCol`→`name`,
     `yCol`→`value` and the scatter case already reads `xCol`/`yCol` as coordinate pairs — corroborating
     the above. Confirmed `buildAggregateDataOption` is bar/line-only (`useAggregate` gate) — matches
     D4/spec's "aggregate render path (bar/line) MUST apply the same active-type options" scope.
   - `ChartCreatorFields.tsx` (read in full): confirmed today's chart-type creation selector only offers
     line/bar/pie — validates the ticket gap and D6/task 2.8's scatter addition.
   - Grepped `editors/` and `shared/ui/` for existing numeric-control precedent: `AppearanceEditor.tsx`
     has a `type="range"` slider (transparency) and `DividerEditor.tsx` has a `type="number"` `TextField`
     (weight) — confirms the design's slider/checkbox controls for `barGapPct`/`donutHolePct` are backed
     by real, already-precedented components, not hand-waved.
   - `PanelDetailModal.css` (grepped `@media (max-width: 768px)`): confirmed the existing 44px
     touch-target block the design proposes to extend already exists.

3. **ECharts-mapping check (AC: "no fake controls")** — every control in D4/the `echarts-chart-panel`
   spec maps to a real ECharts construct: `series.smooth`, `series.showSymbol`, `series.areaStyle`,
   axis-role swap for horizontal bars, `series.stack`, `series.barCategoryGap`, `series.radius` (donut),
   `series.label` formatter (percent labels), a computed third data dimension + `symbolSize` function
   (scatter size), and one-series-per-distinct-value grouping (scatter color, the same grouping
   mechanism `buildDataOption` already uses for bar/line `series` fieldMapping). The one synthetic
   construct — "normalized" stacking — is explicitly disclosed as a client-side percent transform (ECharts
   has no native normalized-stack primitive) rather than presented as a native option, which is honest,
   not a fake control.

4. **No placeholders/TBD/contradictions found** in `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
   or any of the four spec deltas — read all files in full, grep for `TODO|TBD` returned nothing.

5. **AC → task traceability**: all three ACs and all three DoD bullets map to specific tasks/spec
   scenarios (swap behavior → chart-type-config-editor spec + task 2.3-2.5; no-fake-controls → D4 +
   echarts-chart-panel spec + task 2.7; no regression on type-switch → chart-type-display-config spec
   "Switching chart type preserves all config" + task 3.7 acceptance test).

### Verdict: CONFIRM

### Non-blocking notes

- D4/task 2.7: `buildAggregateDataOption` (bar/line groupBy aggregate path) only ever emits a single
  series, so `stacking: "stacked"`/`"normalized"` are degenerate there (a lone series stacked against
  nothing, or trivially 100%). The design/spec say the aggregate path "MUST apply the same active-type
  options," which is fine as stated, but the executor should make sure the *tests* for the aggregate
  path (task 3.6) don't assert a multi-series stacking scenario that the aggregate path can't produce —
  just single-series degenerate behavior.
- Task 1.3/RequestValidation: no existing numeric-range validator precedent (only enum validators exist
  today — `validateTableDensity`, `validateImageFit`, `validateChartType`, `validateDividerOrientation`).
  Adding `barGapPct`/`donutHolePct` clamp validators is straightforward but is new shape, not a copy-paste
  of an existing numeric validator — worth a beat of care during implementation, not a design defect.
