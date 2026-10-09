## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD `3d63a1751bcfd09595943ce390f8f10678e44e49` (change dir untracked; artifacts: ticket.md, proposal.md,
design.md, tasks.md, specs/{csv-blank-cell-null,pipeline-filter-op,pipeline-generatetext-op,pipeline-convertformat-op}).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/csv-blank-cells-null/HEL-1408`.

### What I verified (with evidence)

**Owner rulings.** I read `.concertino/runs/HEL-1408/events.jsonl` lines 4 and 7. The escalation had 8 sub-questions
and the answer was `["rec" x8]` (answer_source human). D1 (Q1 whitespace = null, Q2 skip fully blank lines), D3 (Q3
compat), D4 (Q4 null-as-empty, absent key still fails), D5 (Q5), D6 (Q6 "—", Q7 "null" label) and D7 (Q8 timestamp)
match the recommendations as worded. I did not relitigate them.

**CSV read paths. Claim: one loader. Confirmed, with one omission.**
- `InProcessPipelineEngine.loadCsvRowsFromBytes` (lines 799-809) is the only in-process CSV row loader. Root and
  secondary reads both go through `loadRowsWithStats`: `InProcessExecutionBackend.scala:54`, and `makeContext`
  at line 705.
- `SchemaInferenceEngine.fromCsvLines`, `parseCsvRowsLines` (preview, `DataSourceService.scala:1316`) and
  `ColumnClassifier` read raw strings, as D2 says.
- `ConvertFormatStep.parseCsvRows` is a text transform. The proposal excludes it correctly.
- HEL-1257 is not on main. `CsvLimits.scala:13` still says "TEMPORARY pending HEL-1257".
- **Not mentioned anywhere:** `SparkJobSubmitter.scala:201-209` reads CSV via `spark.read.option("header","true")
  .option("inferSchema","true").csv(path)`. It is dead in production: `PipelineRunService.scala:142-143` falls back to
  `InProcessExecutionBackend` when `executionBackend == null`, and `ApiRoutes.scala:457` passes `null`. So this is a
  non-blocking note, not a change request.
- The persona template CSVs contain no blank cells (grep: 0 in all four). First-run templates are unaffected.

**Code claims I checked against the tree. All accurate.**
- `PipelineRowJson.anyToJsValue` maps `null` to `JsNull`, so there is no NPE downstream.
- `FilterStep.evalCondition` (101-131) behaves as D3 describes. The omitted value defaults to `""`.
- AI/text steps: `case None | Some(null) => fail("field-missing")` at `ConvertFormatStep:57`, `AnalyzeWithAiStep:62`
  and `GenerateTextStep:62`.
- `convertformat` csv→json of `""` gives `[]` (`parseCsvRows` returns empty, then `"[]"`). The new spec scenario is right.
- `SortStep.apply` (129-137) puts nulls last in both directions. The spec scenario `9,5,blank` is right.
- `JoinStep`, `LookupStep` and `DedupeStep` use `getOrElse(_, null)` keys, so null matches null, as D7 says.
- `PivotStep:103` drops null column values. `FillNullStep:106` fills only `== null`.
- `CastStep:70` already maps null to null.
- `inferShallowFromJsObjects` (170-198) skips `JsNull` and `inferJsonType(JsString)` checks timestamps first, so Q8
  holds.
- `NodeSnapshotRepository.topDistinctValues` has `IS NOT NULL`, which covers the D7 distinct-values row.
- `DataGrid.formatCell` returns `"—"` for null.
- `MetricOutputPanel.tsx:72-78` aggregates over stringified `rawRows` (null becomes `""`), which confirms the D6 defect.
  `OutputPreviewPane` and `ChartOutputPanel` already use typed rows.
- The generatetext baseline spec says "`field-missing` (input field absent or null)". The delta correctly narrows it to
  absent. The analyzewithai op spec does not codify `field-missing`, so it needs no delta.

**Test strategy.** Red-first is achievable with the real loader. `InProcessPipelineEngineSpec.scala:1981-1992` already
builds a `CsvSource` over a temp file and calls `engine.loadRows`. On today's code, `count(t)` over `1,A / 2, / 3,B / 4,A`
is 4 and `fillnull` leaves `""`, so 3.1 goes red before 1.1. Mutation proof 3.8 is planned. Constraint C2
(CSV-loaded frames) is sound.

**Consumer enumeration (the key judgment). Incomplete. I probed beyond D7 and found consumers whose results change and
that are neither enumerated nor tested:**

1. **Cross-filter from the blank category breaks (functional regression).**
   - Today a CSV blank groups as `""` in `groupAndAggregate` (`utils/aggregate.ts:110`, `String(row[groupBy])`).
     Clicking it gives selection value `""` (`chartClickSelection.ts:142`, `mapAggregateClickToSelection`).
     `PanelInspectView.tsx:90` dispatches `setCrossFilter(selection)`. Sibling panels then match `""` cells
     client-side (`crossFilterRows.ts:30` `cellMatchesValue`, `:61-66` stringify null to `""`) and server-side
     (`eq ''` against `data ->> col`).
   - After the change the category is `"null"`. The client fallback compares `""` with `"null"`, which never matches.
     The server `eq 'null'` never matches SQL NULL. Every sibling panel drops to zero rows, while the originating
     panel's inspect (`filterRecordsForAggregateSelection`, `String(null) === "null"`) still shows the blank rows.
     The two sides disagree.
   - The owner accepted the "null" **label** (Q7). The escalation never put this interaction break to him, and
     design.md does not mention it.
2. **Row counts change because blank lines are skipped (Q2).** Today a blank line becomes a row: `parseCsvLine("")`
   gives `Vector("")`, then `padTo` produces an all-`""` row. Skipping it changes `assert rowCountMin/rowCountMax`
   (`AssertStep:226-232`), the Output `rowCount`, the alert `"*"` metric (`AlertEvaluationService.extractMetric`,
   `HistoryBaseline.summaryValue("*")`), and so `previous`/`rolling_avg` baselines on the first run after deploy. It
   also changes `limit` and the run row counts. The proposal states the rule, but no D7 row or test pins the
   downstream effect.
3. **`assert regex`** (`AssertStep:250-253`) fails a null outright. A pattern that matched `""` today (e.g. `^$|^\d+$`,
   `.*`, `^\s*$`) now fails the run. Missing from D7.
4. **Filter `contains`** (`FilterStep:106`): `contains ""` (or an omitted value) matched every blank today and now
   excludes them. D3 makes `=`/`!=` compatible but leaves `contains` silently strict. Missing from D7.
5. **Upsert into a dataset** (`DatasetRowValidator.validateRowStructured:136-148`): a null cell takes `field.default`
   when one is declared, and is accepted as `JsNull` for an optional field. So a blank now writes the column's
   **default**, and a blank into an optional numeric column now succeeds where `validateValue(integer, "")` rejected
   the whole write. D7 lists only "required: rejected".
6. **Output table server sort** (`NodeSnapshotFilterSql.orderByFragment:109-117`, `ASC/DESC NULLS LAST`): blank text
   cells sorted first ascending; now they sort last in both directions. D7's sort row covers only the pipeline
   `sort`/`window` steps.
7. **`groupby` step `count`** (`GroupByStep:85`, `!= null`) now excludes blanks. D7 has "aggregate/groupBy key" but no
   groupBy-step count row, and 3.3 lists only "groupBy null key".
8. **Assistant/MCP grounding** (`WorkspaceContextComputations.scala:263-303`): column `nullRate` now counts blanks, and
   distinct/example values and the Jaccard join-key overlap (~430) exclude `""`. The proposal's Impact section omits
   it, and the orchestrator brief explicitly asked about this consumer.

Items 3-8 are low-risk mechanically. But the ticket's acceptance criteria require "every consumer whose results
change" to be enumerated and pinned deliberately, and design.md presents D7 as that list. Item 1 is a user-visible
interaction regression that needs a decision.

**AC coverage.**
- AC1 (red-first count/count_distinct/fillnull): task 3.1.
- AC2 (regression suite): 3.3, incomplete per items 1-8.
- AC3 (release note for users): **no task covers it.** The proposal and design Risks say "release note in the PR body",
  but tasks.md has no item to write it or to define what it must say.

### Verdict: REFUTE

Category: spec-divergence. The artifacts claim a complete consumer enumeration that the tree contradicts.

### Change Requests

1. **Cross-filter on the blank/"null" category** (`frontend/src/utils/crossFilterRows.ts:30,61-66`;
   `utils/chartClickSelection.ts:142,153`; server `eq` via `useCrossFilterServerOps`):
   - Add a D7 row and a decision.
   - Either make a null-category selection cross-filter null cells consistently on both the client fallback and the
     server `eq` path, scoped narrowly enough not to collide with a literal `"null"` string, or escalate it to the
     owner as a product question that Q7 did not settle.
   - Add a test that goes red today on the chosen behaviour.
2. **Extend D7 and task 3.3** with these rows. Give each its own CSV-loaded assertion of the new value:
   - (a) blank-line skip effect on `assert rowCountMin/Max`, Output `rowCount`, and the alert `"*"` metric/baseline;
     state in D8 whether a first-run-after-deploy baseline jump is acceptable.
   - (b) `assert regex` failing on blanks.
   - (c) filter `contains` with an empty/omitted value. Either extend D3's compat to it with the owner's Q3 rationale,
     or state that strict is intended. Do not leave it implicit.
   - (d) upsert: null takes the declared `default`, and an optional typed column now accepts a blank.
   - (e) Output table server sort puts blanks last in both directions.
   - (f) `groupby` step `count` excludes blanks.
   - (g) assistant/workspace grounding `nullRate`/distinct/join-overlap. Add it to the proposal's Impact section.
3. **Add a task for the user release note (AC3).** It should specify the text's minimum content: the behaviour changes
   users will see (counts drop, `notNull`/`regex`/`rowCount` asserts can newly fail, required upserts reject blanks,
   defaults fill blanks, the "—" render, the "null" category, blank lines skipped, existing snapshots keep `""` until
   the next run), and where it lives (PR body).
4. **Pin the snapshot distinct-values row.** It is in D7 but missing from task 3.3's list. Either add it to 3.3 with
   how it reaches the CSV loader (run, then `topDistinctValues`), or say why existing coverage of `IS NOT NULL` is
   enough.

### Non-blocking notes
- `SparkJobSubmitter.scala:201-209` is a second CSV reader. It is unreachable in production (`executionBackend = null`
  at `ApiRoutes.scala:457`), and Spark's CSV reader already treats empty as null by default. Name it in D2/Non-goals so
  the "one loader" claim is literally true.
- D1 says blank-line skipping matches `parseCsvRowsLines`' `filter(_.nonEmpty)`. That filter does not skip
  whitespace-only lines, and `fromCsvLines` (inference) skips no blank lines at all. The run-path rule (Q2) is still
  right; just correct the "matching" wording.
- A comma-only line such as `,,,` is not a "fully blank line" under D1 and stays an all-null row. That reading is
  consistent with Q2's wording, but put it in a 3.2 loader case so it is pinned rather than incidental.
- Follow-ups (`coalesce()`, `(blank)` label) are to be filed at Delivery. Make sure the `(blank)` follow-up also covers
  CR1's interaction if CR1 is resolved by escalation.
