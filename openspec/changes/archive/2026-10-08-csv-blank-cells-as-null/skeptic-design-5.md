## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Reviewed at HEAD `3d63a1751bcfd09595943ce390f8f10678e44e49` (change dir untracked). Spawn-cwd guard:
`READY ambient=/home/matt/Development/helio branch=bug/csv-blank-cells-null/HEL-1408`. Owner rulings Q1–Q8 not reopened.

### What I verified (with evidence)

**Round-4 CR1 (Inspect predicate): closed.**
- design.md D10a and tasks.md 2.3 now read `value === "" ? (raw === null || raw === "") : String(raw) === value`.
  The `raw != null` guard is gone.
- Evaluated by hand against the current `filterRecordsForAggregateSelection` (`utils/chartClickSelection.ts:148-154`, which
  today is `String(row[groupBy]) === selection.value`):
  - `"undefined"` group: `String(undefined) === "undefined"` lists the absent-key rows, as it does today. Unchanged.
  - Blank selection: lists null and `""` rows. Absent-key rows are excluded, and this is stated explicitly.
  - Literal `"null"` without nulls: `String("null") === "null"`. Unchanged.
- The absent-in-blank rule is pinned in three places:
  - D10a: "absent-key rows are NOT pulled into a blank Inspect";
  - the chart-history-overlay delta: "rows lacking the groupBy key are not included";
  - task 3.7: an `"undefined"`-group Jest case.
- Sibling cross-filter treating absent as blank is acknowledged as existing and unchanged. That divergence is between
  Inspect and sibling filtering, not inside the new rule, and it is disclosed.

**Round-4 CR2 (reachability): closed and true against the tree.**
- `ChartOutputPanel.tsx:84-101` holds `records` and builds `aggregationSpec`.
- It passes `aggregationSpec` down this chain:
  1. `ChartOutputPanel.tsx:120`;
  2. `ChartRenderer.tsx:24,65`;
  3. `ChartPanel.tsx:34,97` (`aggregationSpec: chartAggregate ? aggregationSpec : null`);
  4. `useChartClickHandler.ts:35,80`, then `mapAggregateClickToSelection(params, aggregationSpec)`
     (`chartClickSelection.ts:137`).

  So carrying `groupHasNull` on the spec reaches the click mapper with no new prop chain.
- The probe is pinned as strict `=== null` over `records`, with an explicit "never from rawRows".
- `PanelContent.tsx:273` passes `records={filteredPaginationRows}` to `ChartOutputPanel`. The metric branch
  (`PanelContent.tsx:316-322`) passes only `rawRows`, so D6/2.1's "thread at :320" names the right site.
- The HEL-1351 comment cited for update is real (`PanelInspectView.tsx:84-87`).
- Inspect's aggregate path (`PanelInspectView.tsx:108-111`) filters by selection value only, so it needs no
  `groupHasNull`. That is consistent with a value-based predicate.

**Round-4 non-blocking notes: adopted.**
- D6 names `PanelContent.tsx:320`.
- Task 4.1 release note covers the non-CSV null+`""` mutual Inspect listing.

**Earlier rounds:** round 4 verified the round-1 to round-3 CRs as closed (grouping unchanged on client
`aggregate.ts:110` and server `OutputSummaryReducer`, fixture untouched, sort and overlay alignment intact). Nothing in
the round-5 edits reopens them: grouping text in D10a still says `groupAndAggregate`/`OutputSummaryReducer` keying is
unchanged.

**Consistency spot-checks:**
- `FilterStep.evalCondition(fieldVal: Any, ...)` (`FilterStep.scala:102-117`) receives null for both null and absent.
  So the filter delta's "null (or absent)" wording matches what task 1.2 would implement.
- The output-routes-api delta scenario (`eq ""` returns null and `""`, lines 162-163) matches D10b and task 1.4.
- No `TODO`/`TBD`/deferred placeholders in design, tasks, proposal or deltas (grep, zero hits).

### Verdict: CONFIRM

The design is sound enough to implement. Every AC area is covered:
- red-first 3.1 / C1;
- the regression suite 3.3 over D7/D7b;
- the release note 4.1.

### Non-blocking notes
- Task 2.2 "carries it on the aggregation spec": prefer a local extended object (`{...aggregationSpec, groupHasNull}`) or
  an optional field over making it required on `ChartAggregationSpec` (`chartOverlay.ts:36`). That interface is the
  shared "is this aggregated" notion used by the overlay selector and the editor preview, and
  `chartAggregationSpec(config)` cannot compute it.
- Keep `groupHasNull` in the `useMemo` deps so the click mapper recomputes when a cross-filter narrows `records`.
