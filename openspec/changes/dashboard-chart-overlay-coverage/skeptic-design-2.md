## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD a606a9833910e36ad544e6aff6e4b87049245559. The branch has no commits beyond main, and the change dir is untracked.
Verification was static only, per the lane rule (no shared Playwright browser at this gate).

### What I verified (with evidence)

- **Owner ruling.** `.concertino/runs/HEL-1351/events.jsonl` line 5 records `escalation.answered`, `sub_answers ["defer-standalone","client-aggregate"]`, `answer_source: human`.
  - Item 2 is deferred to HEL-1358 (proposal Non-goals, C1).
  - Item 1 is grouped client-side (D2, C2).
  - The overlay is drawn only on complete, unfiltered rows. This is C1, and it matches the MODIFIED overlay requirement ("including for aggregated Outputs").
- **R1 CR1 (Inspect for aggregates): addressed.** D3 now covers the `PanelInspectView` path. Selection uses `dimension = groupBy`, and Inspect filters on `String(row[groupBy])` with no series column. The spec is threaded via `ChartInspectConfig`. Task 1.5a, the ADDED scenario "Inspect lists the clicked group's rows", and task 4.3 "Inspect rows" cover it. I checked `PanelInspectView.tsx:83-91` and `chartClickSelection.ts:121-145`: the plan targets the real filter.
- **R1 CR2 (Inspect chart type): addressed.** D7 replaces `resolveChartType(panel.appearance.chart)` at `PanelCard.tsx:462`, and `PanelCard.tsx` is now in Impact. Click mapping is covered too: `useChartClickHandler.ts:68` reads `appearance.chart` from the appearance that `ChartOutputPanel` hands down, and D7 makes that the resolved appearance.
- **R1 CR3 (D7 spec deltas): addressed for text.** I diffed each MODIFIED delta against the live requirement.
  - `echarts-chart-panel` "Chart panel applies persisted per-type display options": only line 3 changes; every scenario is kept.
  - `panel-appearance-settings` "Panel appearance chart merges partially": only the explicit-null THEN changes.
  - `chart-type-selector` "Default chart type is line when none is stored": the heading matches.
  - `chart-history-overlay`: all 9 dashboard/picker scenarios are kept, and new ones are added.
- **R1 CR4 (D6 legend semantics): addressed.** D6 now says the compact hide is lifted and the panel's own legend settings are honoured: explicit `show:false` stays hidden and a stored position is honoured. There is an ADDED scenario "Explicitly hidden legend stays hidden", and task 4.4 includes "explicit-hidden". I checked `buildChartOption.ts:106-215`: the overlay is applied before the compact pass, so "series count grew" is observable where D6 needs it.
- **Non-blocking notes adopted.** D4a (series naming) is task 1.5b. The truncation comment is in D4. The scatter workaround removal is task 1.7.
- **Backend merge supports D7's null.** `model.scala:369` has `chartType = patch.chartType.fold(existing.chartType)(identity)`, so `Some(None)` clears to `None`. `PanelAppearance.Default` (model.scala:396-400) has no `chart`, so a newly created panel has no stored `chartType` and D7's default actually applies to new placements. `ChartAppearance.Default.chartType = Some("line")` (model.scala:238) confirms the "explicit line from a partial PATCH" risk the design records.
- **New finding, verified twice: the detail modal's chart-type selector does not exist.**
  - `PanelDetailModal.tsx:540` passes `showChartSection={false}`, and that is the only `<AppearanceEditor>` mount (grep across `frontend/src`, non-test).
  - `AppearanceEditor.tsx:116` renders `ChartAppearanceEditor` only when `showChartSection` is true.
  - The modal's save payload (`PanelDetailModal.tsx:342-356`) is `{background, color, transparency}` (plus the title). It never sends `chart`.
  - `chartAppearance` / `buildInitialChart` state is passed only to that hidden section, so it is inert.
  - `git log -S'showChartSection={false}'` shows this has been the case since HEL-909 (94874bf48).
  - No detail-modal test references `chartType`.
  - Conclusion: D7's "appearance editor pre-fill / unchanged save keeps it absent (send explicit `chartType: null`)", tasks 3.2 and 4.4a, the `chart-type-selector` delta scenarios ("selector shows 'bar'") and the ADDED scenario "Appearance editor preserves the rendered type" all specify behaviour of a control that is not rendered and a save path that writes no chart.
  - Disclosure: round 1's non-blocking note 2 ("opening and saving the appearance editor … freezes chartType") was itself wrong on this premise. The revision inherited the error from the gate.
- **AC coverage.**
  - AC1 (decide or fix each item, or defer it): items 1, 3 and 4 are fixed and item 2 is deferred.
  - AC2 (item 2 escalated with a recommendation): yes.
  - AC3 (both themes): tasks 4.5 and 4.6.
  - No TODO, TBD or placeholders.

### Verdict: REFUTE

### Change Requests

1. **Re-ground D7's editor clause on the real detail modal (D7, tasks 3.2 and 4.4a, specs).** The detail modal does not render a chart-type selector, and its save never sends `appearance.chart` (`PanelDetailModal.tsx:540` `showChartSection={false}`; `AppearanceEditor.tsx:116`; save payload at `PanelDetailModal.tsx:342-356`). As written, an implementer must choose between two readings:
   - **(a)** Un-hide `ChartAppearanceEditor` so the "selector shows bar" scenario can pass. That is a significant UI change (colours, legend and axis controls reappear), outside this ticket's scope, and it changes what every save writes.
   - **(b)** Add `chart: {chartType: null}` to the save payload. That is a new write. On a chart-less panel it merges over `ChartAppearance.Default` (model.scala:467) and stores a full default chart object where none existed, with no user benefit.

   Revise as follows:
   - **D7:** Record that the chart section has been hidden since HEL-909 and that the modal never writes `chart`. The save path therefore cannot freeze an inherited type, and **no save-payload change is made**. Keep `buildInitialChart` either unchanged or aligned to the resolver, explicitly as inert consistency only.
   - **Tasks:** Drop or reword task 3.2's "unchanged save keeps it absent (`null`)". Drop task 4.4a, or replace it with a test asserting that the modal save payload still carries no `chart` key.
   - **Specs:** In the `chart-type-selector` delta and in the ADDED "Dashboard chart type defaults to the Output's chartType" requirement, remove or reword the selector-in-detail-modal scenarios and the "Appearance editor preserves the rendered type" scenario so they do not mandate behaviour of an unrendered control. Either leave `chart-type-selector` untouched with a note that it is already stale since HEL-909 (out of scope), or keep the MODIFIED default wording without the detail-modal scenarios.

### Non-blocking notes

- **Null-category Inspect.** D3 keys Inspect on `String(row[groupBy])`, which is correct. But `PanelInspectView` currently receives only `rawRows`, where `usePanelData` stringifies `null` to `""` (the reason D2 picked records). If the implementer filters `rawRows` by header index, the `"null"` group's Inspect will be empty. Thread record rows (`paginationRows`) into Inspect for the aggregate branch, and add a null-groupBy case to task 4.3. Separately, "Filter dashboard" on that group writes value `"null"`, which `filterRecordRowsByDimension` (`crossFilterRows.ts`, stringifies null to `""`) will not match. This is acceptable as an edge case, but worth a test or comment.
- **Click handler wiring.** Task 1.5 does not say how the aggregation spec reaches `useChartClickHandler` (inside `ChartPanel`, not `ChartInspectConfig`). Passing it from `ChartOutputPanel` through `ChartRenderer` is the obvious route. The implementer should not try to source it from `ChartInspectConfig`.
- **Cross-filter targeting.** `isPanelFilterableByDimension` matches only `fieldMapping` values (`crossFilterRows.ts`). An aggregated chart whose `groupBy` is not in its `fieldMapping` will not be a cross-filter target, so D2's "cross-filter targeting of an aggregated panel narrows records before grouping" applies only when it is. This is not an AC; a one-line note in D2 is enough.
- **Scenario name.** "Aggregated chart Output gets a specific note" in the picker requirement now asserts the opposite (no aggregation note). Consider renaming it, for example to "Aggregated chart Output gets no aggregation note".
- **Overlapping requirements.** The ADDED "Dashboard chart panels render config.aggregation" overlaps the existing `echarts-chart-panel` aggregation requirement (spec.md:9,44-50). They do not contradict each other, but the overlap is worth noting at archive time.
