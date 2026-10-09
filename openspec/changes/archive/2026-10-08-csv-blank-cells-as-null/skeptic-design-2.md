## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD `3d63a1751bcfd09595943ce390f8f10678e44e49`. The change dir is untracked. Spawn-cwd guard:
`READY ambient=/home/matt/Development/helio branch=bug/csv-blank-cells-null/HEL-1408`. I did not reopen the owner
rulings Q1–Q8.

### What I verified (with evidence)

**Round-1 CRs that are now closed:**
- **CR2(a)–(g).**
  - D7b lists every row: row counts, assert regex, upsert default and optional numeric, server sort, groupby count,
    and WorkspaceContextComputations.
  - The baseline step on the first run after deploy is stated in D7b.
  - `contains ""` is folded into D3, the pipeline-filter-op delta (its scenario "contains "" matches a null row
    value") and task 3.4.
  - WorkspaceContextComputations is in the proposal's Impact.
  - Task 3.3 now says "every design D7 and D7b row".
- **CR3.** Task 4.1 is the release note, with its minimum content listed.
- **CR4.** Task 3.3 includes "snapshot distinct-values/filter dropdown".
- **Notes.**
  - SparkJobSubmitter is named in Non-goals and in the design Context.
  - The D1 wording is corrected: preview skips only empty lines, inference skips none.
  - The `,,,` case is pinned in D1 and task 3.2.

**CR1 (D10): the server side holds; the client mechanism does not as written.**

*Server `eq ""`: callers are safe.*
- Every `OpSpec.Eq` comes from `OutputRowsQueryParsing.scala:99`, which is reached only through `/rows`.
- The in-tree producers are `panelThunks.ts:366` (cross-filter) and `viewerControlValues.ts:153`.
- Viewer text and dropdown controls do `if (raw !== "") ops.push(...eq...)`, so they never send `eq ""`.
- helio-mcp builds no `ops`: grep finds no `ops`/`eq` producer in `helio-mcp/src` outside tests.
- On a numeric column today, `eq ""` compiles to `safe_numeric(data->>c) = safe_numeric('')`, which is NULL = NULL
  and matches nothing. After D10b it matches null cells.
- So no in-tree caller breaks. The only behaviour change is for external PAT callers that send `eq ""`. It is
  documented-contract-visible (see CR2 below).

*Client: D10(a) cannot be implemented as worded.*
- `groupAndAggregate` (`frontend/src/utils/aggregate.ts:110`) keys each group by `String(row[groupBy])`.
  A null key and a literal `"null"` string land in the same Map entry, `"null"`, before any click happens.
- `GroupedAggregate` carries only `categories: string[]` and `values`. No raw key survives.
- `mapAggregateClickToSelection(params, spec)` (`chartClickSelection.ts:137-143`) receives only `params.name`
  (the label) and the spec.
- Its sole caller, `useChartClickHandler.ts:80`, is given `aggregationSpec`, not `chartAggregate`
  (`ChartOutputPanel.tsx:88-100` builds `chartAggregate` but passes it only to the renderer).
- So "resolves the clicked group's raw key, not its label" has no data to resolve from. A competent implementer
  could read task 2.2 two ways:
  - (i) map `params.name === "null"` to `""`. A literal `"null"` string category then cross-filters siblings to
    blank rows: the exact collision round-1 CR1 said to avoid.
  - (ii) restructure `groupAndAggregate` so the null group is distinct. That is an unplanned change to a shared util
    used by `OutputPreviewPane.tsx:95` and `ChartOutputPanel.tsx:92`, with an open question: a column holding both
    null and `"null"` would get two categories both labelled `"null"`.
- The design chooses neither. It also does not say how the originating Inspect filter changes.
  `filterRecordsForAggregateSelection` (`chartClickSelection.ts:153`, `String(row[g]) === value`) gives
  `String(null) = "null" !== ""`, so as written a `""` selection lists zero rows for the null group. For a
  JSON-typed source holding both `""` and null, the `""` bar and the `"null"` bar would both select `""` and both
  Inspect the union.
- Task 3.7 tests only "chartClickSelection null group → `""`". It does not test the literal-`"null"` collision or the
  aggregate Inspect rows.

**Contract deltas missing for D10.**
- `openspec/specs/output-routes-api/spec.md:78-80` says every `ops` value is compared "using the same value-typed cast
  the column itself uses". D10b ("regardless of cast", a `IS NULL OR = ''` rewrite) contradicts it, and there is no
  MODIFIED delta. The new requirement sits only in the new `csv-blank-cell-null` capability, so the baseline spec
  would keep a now-false statement.
- `openspec/specs/chart-history-overlay/spec.md:110-112` ("Dashboard chart panels render config.aggregation")
  requires the selection value to be "the clicked category". It also requires Inspect to list "rows whose groupBy
  value equals that category". D10 changes both for the null category, and there is no delta.

**Does D10 change product behaviour beyond the accepted rulings? Yes, in three places.**
- (1) It applies to every source kind, not only CSV. A SQL/REST/JSON null category stops producing selection
  `"null"`, which matches nothing, and starts cross-filtering siblings to null-or-`""` rows. This reverses the edge
  HEL-1351 documented and accepted (`PanelInspectView.tsx:84-87` comment).
- (2) Public `/rows` `eq ""` now matches null for every Output.
- (3) The selection header reads `team: ` (empty value) where today it reads `team: null`.

None of the rulings decides these, but they all apply Q3's "`""` and null are both blank" rule, and they prevent a
regression Q7 would otherwise cause. I judge them within the planner's self-approval and not escalation-worthy. They
do need to be recorded: in the specs (CR2) and in the release note. Task 4.1 lists "every D7/D7b change", and D10 is
in neither table.

### Verdict: REFUTE

Category: spec-divergence. D10's client mechanism is ambiguous and not implementable as worded, and two existing
contract specs go stale without deltas.

### Change Requests

1. **D10(a) and task 2.2: specify a client mechanism that can actually be built.**
   - Name the data path by which the click learns that the group key was null. For example, `groupAndAggregate`
     returns per-category raw-key info (such as a `nullCategoryIndex`), `ChartOutputPanel` passes it to
     `useChartClickHandler`, and the click uses `params.dataIndex`.
   - Decide explicitly whether null and a literal `"null"` remain one merged group or become two. A literal `"null"`
     category must never map to `""`.
   - State the new `filterRecordsForAggregateSelection` rule for a `""` selection, so the originating Inspect lists
     the clicked group's rows.
   - Extend task 3.7 with: (a) a literal `"null"` string category stays `"null"`; (b) the aggregate Inspect for the
     null group lists exactly its rows; (c) the existing HEL-1351 accepted-edge comment at
     `PanelInspectView.tsx:84-87` is removed or updated (task 2.2).
2. **Add MODIFIED deltas.**
   - `output-routes-api` "GET /api/outputs/:id/rows returns paginated data rows": `eq` with an empty value matches
     null or `""` regardless of the column cast, with a scenario.
   - `chart-history-overlay` "Dashboard chart panels render config.aggregation": the null category's selection value
     is `""`, and its Inspect lists the null-keyed rows, with a scenario.
3. **Task 4.1:** add D10 to the release note's required content. Cover: a blank or null chart category now
   cross-filters to blank rows, for all source kinds; and `/rows` `eq ""` now also matches null.

### Non-blocking notes
- D7b's alert-baseline step is stated, not ruled acceptable. Writing "acceptable, release-noted" in D8 would close
  round-1 CR2(a) literally.
- Task 3.3's parenthetical omits the alert `"*"` metric, although "every D7 and D7b row" covers it. Consider naming it.
