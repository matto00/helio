## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed at HEAD `3d63a1751bcfd09595943ce390f8f10678e44e49`; the change dir is untracked. Spawn-cwd guard:
`READY ambient=/home/matt/Development/helio branch=bug/csv-blank-cells-null/HEL-1408`. Owner rulings Q1–Q8 are not
reopened.

### What I verified (with evidence)

**Round-3 CRs.**
- **CR1 (server side of grouping): closed.** Grouping is now unchanged on both sides:
  - client `groupAndAggregate`, `aggregate.ts:110`, keys `String(row[groupBy])`;
  - server `OutputSummaryReducer.groupAndAggregate`, `OutputSummaryReducer.scala:39-42`, keys `jsString`, where
    `JsNull` gives `"null"` and None gives `"undefined"`.

  So the delta sentence "missing values group as the preview and the stored summary series group them" is true
  again.
- **CR2 (undefined): closed at the grouping level.** `shared-test-fixtures/output-summary-reducer.json` and both seam
  suites are untouched. The Inspect predicate, however, contradicts the design's own "`undefined` is unchanged" claim
  (see the new finding below).
- **CR3 (sort): closed.** Keys are unchanged, so sort order is unchanged. The existing `["east","null","west"]` pins
  hold.
- **CR4 (overlay alignment): closed.** There is again exactly one category labelled `"null"`. `applyChartOverlay`
  aligns by label as today.
- **Round-3 notes:**
  - D8 addendum: present (Planner Notes).
  - `dataIndex`: no longer needed.
  - "Inspect lists the null or `""` rows": adopted in the delta scenario.

**Are the loaded records reachable where the aggregate click handler is built? No, not as D10a claims.**
- `useChartClickHandler` is built in `ChartPanel.tsx:91`. Its params (`useChartClickHandler.ts:27-46`) are
  `appearance`, `rawRows: string[][]`, `headers`, `fieldMapping`, `chartOptions`, `aggregationSpec` and
  `onDataPointSelect`. There are no records.
- `rawRows` stringifies null to `""`, so a null groupBy value cannot be detected from it. A `""` there is
  indistinguishable from a literal `""`.
- The records live one component up the chain:
  1. `ChartOutputPanel` (`records` prop, `ChartOutputPanel.tsx:27`, used at line 89 to group).
  2. `ChartRenderer` forwards no records.
  3. `ChartPanel` forwards no records.
- On every surface the records do reach `ChartOutputPanel`. All five go through
  `PanelContent.tsx:264-273`, which passes `records={filteredPaginationRows}`:
  - dashboard card: `PanelCard.tsx:302` → `PanelCardBody.tsx:256`;
  - mobile: `MobilePanelStack` → `PanelCard`;
  - fullscreen: `PanelFullscreenOverlay.tsx:229`;
  - detail modal: `PanelDetailModal.tsx:505`;
  - public viewer: `PublicDashboardViewerPage.tsx:122`.
- **What has to be threaded:** either pass `records` through `ChartRenderer` → `ChartPanel` → `useChartClickHandler`
  → `mapAggregateClickToSelection`, or (smaller) compute a boolean in `ChartOutputPanel` and carry it on
  `aggregationSpec` or `chartAggregate`. The boolean is "some record has `row[groupBy] === null`", over the same
  `records` it groups. Task 2.2 names neither, and D10a's parenthetical "(already available where
  `useChartClickHandler` is built)" is false. An implementer trusting it is likely to probe `rawRows`, which gives the
  wrong semantics.
- The same applies to D6: `MetricOutputPanel` (`MetricOutputPanel.tsx:26,72-75`) receives only `rawRows`. The typed
  rows (`filteredPaginationRows`) must be passed from `PanelContent.tsx:320`. This is a one-line thread, but it is
  likewise unnamed.

**New defect: the D10a / task 2.3 Inspect predicate breaks the `"undefined"` group.** The predicate in D10a is
`value === "" ? (raw == null || raw === "") : (raw != null && String(raw) === value)`. I evaluated it in node against
records `{team:"a"}`, `{}` (absent), `{team:null}`, `{team:""}` and `{team:"null"}`:

```
"undefined" group rows [ 2 ]  proposed Inspect []        <- today: [2]
""          group rows [ 4 ]  proposed Inspect [ 2,3,4 ]
blank sel (null click)        proposed [ 2,3,4 ]          <- includes the absent-key row
```

- The `raw != null` guard excludes absent-key rows, so clicking the `undefined` bar opens an Inspect with zero rows.
  Today it lists them, because `String(undefined) === "undefined"`. This contradicts D10a's own "`undefined` (absent
  key) is unchanged" and the delta's "Inspect SHALL list exactly the loaded rows whose groupBy value equals that
  category".
- The guard is also never needed:
  - if any loaded value is null, a `"null"` click is already rewritten to `""`;
  - otherwise there are no null raws to exclude.
- Absent keys are reachable on non-CSV sources: sparse JSON/REST objects stored as jsonb. The HEL-1271 fixture pins
  an absent case for exactly this reason.
- The blank branch's `raw == null` also sweeps absent-key rows into a blank selection. This matches sibling behavior:
  server `data ->> col IS NULL` and client `filterRecordRowsByDimension` both read undefined as blank. But the delta
  scenario says "exactly the rows … null or the empty string" and does not mention absent rows. Pin one rule.
- The click condition "any loaded record's groupBy value is null" does not say whether this is `=== null` or
  `== null`. With `== null`, a panel with absent keys plus a literal `"null"` group would wrongly rewrite to `""`.

**Delta and scenario consistency with the unchanged reducer and fixture.**
- With grouping unchanged, the chart-history-overlay delta's scenarios are consistent:
  - "Click on the null group selects blank";
  - "A literal 'null' category without nulls keeps its value";
  - the summary-series parity sentence;

  and with `OutputSummaryReducer` and the fixture (no fixture edit needed).
- Sibling client matching (`crossFilterRows.ts:65-75`) already reads null and undefined as `""`.
- `useCrossFilterServerOps.ts:78-82` passes `""` through, since only `null` short-circuits.
- Server `eq` (`NodeSnapshotFilterSql.scala:63-64`) is a plain `=` today, so task 1.4 is a real and needed change.
- No consumer treats an empty selection value as falsy: I grepped `selection.value` and `crossFilter.value`.

### Verdict: REFUTE

Category: spec-divergence. The D10a/2.3 predicate as written contradicts the design's own "`undefined` unchanged"
statement and the delta requirement, and would ship an empty-Inspect regression for absent-key groups. D10a also
asserts a false fact about where the records are available. Both fixes are small and textual.

### Change Requests

1. **Fix the Inspect predicate (design.md D10a, tasks.md 2.3).**
   - Drop the `raw != null &&` guard on the non-blank branch:
     `value === "" ? (raw === null || raw === undefined || raw === "") : String(raw) === value`.
   - Decide explicitly whether a blank selection includes absent-key rows. I recommend yes, to match sibling
     client/server blank matching. Then state it in the chart-history-overlay delta scenario ("null, absent or the
     empty string"), or exclude absent rows and say so.
   - Add to task 3.7 a Jest case where clicking the `undefined` group lists its absent-key rows, plus the chosen
     absent-in-blank case.
2. **Correct the reachability claim and name the threading (D10a, task 2.2).**
   - Replace "(already available where `useChartClickHandler` is built)" with the actual path. Records live in
     `ChartOutputPanel` (`records` prop), which every surface reaches via `PanelContent.tsx:273`. Either pass a
     precomputed boolean from `ChartOutputPanel` (e.g. on `aggregationSpec` or `chartAggregate`), or pass `records`
     through `ChartRenderer` → `ChartPanel` → `useChartClickHandler`.
   - State that `rawRows` must not be used for the null probe.
   - Pin the probe as `row[groupBy] === null`, not `== null`.

### Non-blocking notes
- D6 / task 2.1: name the thread `PanelContent.tsx:320`, i.e. pass `filteredPaginationRows` to `MetricOutputPanel`,
  which today receives only `rawRows`.
- On non-CSV sources holding both null and literal `""`, the `""` bar's Inspect now also lists the null rows, and the
  null bar's Inspect lists the `""` rows. This is consistent with the documented "blank = null or `""`" rule. Worth one
  sentence in the release note.
