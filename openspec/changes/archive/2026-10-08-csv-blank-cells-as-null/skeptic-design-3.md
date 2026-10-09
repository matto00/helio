## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD `3d63a1751bcfd09595943ce390f8f10678e44e49`; change dir untracked. Spawn-cwd guard:
`READY ambient=/home/matt/Development/helio branch=bug/csv-blank-cells-null/HEL-1408`. Owner rulings Q1–Q8 not reopened.

### What I verified (with evidence)

**Round-2 CR2 (MODIFIED deltas) — closed.** I extracted each MODIFIED requirement block and diffed it against
the baseline with a Python script (difflib).
- `output-routes-api` "GET /api/outputs/:id/rows returns paginated data rows": the only differences are the appended
  `eq ""` exception sentence (baseline line 28) and the new scenario "eq with an empty value matches null and empty
  cells". Everything else is byte-identical.
- `chart-history-overlay` "Dashboard chart panels render config.aggregation": the only differences are the null-group /
  blank-click / blank-Inspect sentences and two new scenarios. Everything else is identical.

**Round-2 CR3 (release note) — closed.** Task 4.1 names D10, its scope beyond CSV, and `/rows` `eq ""`.

**Round-2 CR1 (client data path) — the click mechanism is now buildable.**
- `params.dataIndex` holds up on every aggregated click path:
  - `buildAggregateDataOption` (`chartDataOptions.ts:184-210`) emits bar/line `data: aggregate.values` and pie
    `data: categories.map(...)`. Both are index-aligned with `categories`.
  - The "vs" overlay series (`chartOverlayOption.ts:54`) is `xAxis.data.map(...)`, the same length and order. An
    overlay click therefore carries the same `dataIndex` as the category.
  - Normalized stacking (`chartTypeOptions.ts:69`) is an index-preserving `map`.
  - Nothing in the tree reorders series data.
- `ChartClickParams` (`chartClickSelection.ts:75-80`) has no `dataIndex` field today. Adding it is implied by
  task 2.3 but not named. This is minor.
- Server `eq ""` is reached only through cross-filter (`useCrossFilterServerOps.ts:78-82` passes `""` through).
  This is consistent with round 2.

**The sentinel keying breaks the HEL-1271 client/server summary parity seam, and nothing in the plan addresses it.**
- The design (D10a, design.md:81) keys "a null/undefined value under a private sentinel". Today
  `groupAndAggregate` (`aggregate.ts:110`) keys `String(v)`, so null → `"null"` and absent → `"undefined"`.
- The shared fixture `shared-test-fixtures/output-summary-reducer.json` case "non-numeric keys" contains
  `{k:null,y:4}` and `{y:5}` (absent). It expects categories `["B","a","b","false","null","true","undefined"]` and
  values `[8,2,4,7,4,6,5]`. Two suites assert this same fixture:
  - Jest: `frontend/src/utils/aggregate.fixture.test.ts:62-63`, `toEqual(c.expected)`.
  - Scala: `OutputSummaryReducerSeamSpec.scala:46-53`.
- As designed, null and absent merge into one group (value 9, no `"undefined"` category), so the Jest fixture test
  goes red. Editing the fixture instead turns the Scala seam spec red, because `OutputSummaryReducer.groupAndAggregate`
  (`OutputSummaryReducer.scala:39-42`, keyed by `JsSemantics.jsString`, where `JsNull` gives `"null"` and None gives
  `"undefined"`) is not in the plan.
- `toEqual` also fails once `nullCategoryIndex` is added to the returned object. That is expected, but the fixture's
  `expected` shape has no `nullCategoryIndex` either.
- Neither the design nor the tasks mention `OutputSummaryReducer` grouping, the shared fixture, or the seam spec.
  The implementer would have to decide unilaterally whether to change a cross-language persisted-summary contract.
- The MODIFIED chart-history-overlay text keeps "so missing values group as the preview and **the stored summary
  series** group them" and adds "a null groupBy value SHALL form its own group … separate from a literal `"null"`".
  The stored summary (server) still merges null and `"null"`, so the delta contradicts itself.
- `ChartOutputPanel.aggregate.test.tsx:38` documents the same parity ("`String(null)` = "null" in the preview, the
  dashboard and the server").

**Overlay alignment with two `"null"` labels is undefined.**
- `applyChartOverlay` (`chartOverlayOption.ts:47-59`) aligns overlay points to the primary categories by
  `String(category label)`.
- With null and a literal `"null"` both labelled `"null"`, both categories get the same overlay point: the server's
  merged null+`"null"` baseline. Each "vs" value is then silently wrong.
- When null and absent are merged client-side but split server-side, the null bar's baseline covers only part of
  its rows.
- The design does not say what the overlay should do here, and task 3.7 does not test it.

**Sort position is unspecified.** "Groups are sorted by category key". With a private sentinel key, where the null
group sorts depends on the sentinel string chosen. Existing pinned orderings would move:
- `["east","null","west"]` in `PanelCard.aggregateChart.test.tsx:148` and `ChartOutputPanel.aggregate.test.tsx:83`.
- The fixture order `"false","null","true"`.
- The server's sorted order.

The design must pin the order.

### Verdict: REFUTE

Category: spec-divergence. D10a as written breaks the client/server grouping parity contract (HEL-1271 shared
fixture plus seam spec). The plan neither covers that nor decides it, and the new chart-history-overlay delta
contradicts itself on it.

### Change Requests

1. **Decide the server side of D10a's grouping change.** design.md D10 must pick one of these and say so explicitly:
   - **(a)** Port the same keying into `OutputSummaryReducer.groupAndAggregate`. Then also decide how the stored
     summary point's `x` represents the null group (for example `JsNull`, which `applyChartOverlay` already skips, or
     `"null"`). Note that stored history from before the deploy keeps the merged group.
   - **(b)** Keep the server merge and amend the chart-history-overlay delta's "as … the stored summary series group
     them" sentence to state the divergence.

   Add a task for whichever is chosen. If (a), also add a Scala reducer/seam task.
2. **Decide `undefined` (absent key) explicitly.** Either the sentinel applies to null only (absent stays
   `"undefined"`, preserving the fixture case), or null and absent merge, in which case the fixture and the Scala port
   change in step. Update the shared fixture `shared-test-fixtures/output-summary-reducer.json` with a null-vs-literal-
   `"null"` case (and an absent case) so both `aggregate.fixture.test.ts` and `OutputSummaryReducerSeamSpec` pin the
   chosen rule. Name this in task 3.7 or a new task.
3. **Pin the sort position of the null group.** For example: "sorted as if its key were `"null"`, ties broken
   null-group-first". Then the existing `["east","null","west"]` assertions and the fixture order stay valid, or are
   updated deliberately.
4. **Specify overlay alignment when two categories share the `"null"` label.** For example, the null group takes
   only a null-x overlay point, or no point, and the literal group takes the `"null"` point. Add a Jest case
   (applyChartOverlay or ChartOutputPanel) for null plus literal `"null"` plus an overlay.

### Non-blocking notes
- Name `dataIndex?: number` as an addition to `ChartClickParams` (`chartClickSelection.ts:75`) in task 2.3.
- Pie with two `"null"`-named slices: ECharts' legend toggles by name, so the legend shows a duplicate `"null"`
  entry and toggling it hides both slices. This is acceptable until the `(blank)` label follow-up. Consider
  mentioning it.
- Scenario "Click on the null group selects blank … Inspect lists exactly those rows" holds only when there are no
  `""` rows. The requirement text (null-or-`""` union) is the true rule; consider "exactly the null or `""` rows".
- Round-2 note still open: D8 could say the alert-baseline first-run step is "acceptable, release-noted".
