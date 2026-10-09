## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `f5725f6b7d3ab65a2f633913c25c3ffe04c312b7`. Diff base (live-resolved): `3d63a1751bcfd09595943ce390f8f10678e44e49`.

### Fresh gate runs (evaluator's own runs, not the executor's report)

| Gate | Result |
|---|---|
| `npm run lint` | pass (0 warnings) |
| `npm run format:check` | pass |
| `npm run typecheck` | pass |
| `npm test` (`--maxWorkers=3`, nice 19) | pass: 477 suites, 5027 tests |
| `npm --prefix frontend run build` | pass |
| `cd backend && sbt testFull` (nice 19, default serial forked groups) | pass: **6360 run, 0 failed**, 455 suites, 0 aborted, 4 canceled (same as executor claim) |

### Mutation proofs (evaluator-run, in a throwaway detached worktree at the reviewed SHA, removed afterwards)

Backend:
- **Revert D1** (loader back to `padTo(headers.size, "")`, no blank-line skip): 31 of 38 tests in `CsvBlankCellsNull{,Steps,Snapshot,Workspace}Spec` go red, including both task-3.1 red-first cases (`count`/`count_distinct`, `fillnull`) and every D7/D7b regression row. The 7 that stay green are the intended guards: non-blank cells not trimmed, header unchanged, inference/preview unchanged (x2), stringops concat unchanged, and the two D10b `eq` cases, which test the SQL, not the loader. This reproduces the red state 3.1 needs. Note: C1's *temporal* claim ("observed failing before groups 1-2") cannot be checked from the artifacts. The change is one squashed commit, and no red-first output is persisted under `.concertino/runs/HEL-1408/evidence`. This mutation proves the test is red without D1. It does not prove the order the work was done in.
- **Revert D3** (FilterStep): `FilterStepSpec` "blank-cell compat" goes red.
- **Revert D10b** (`NodeSnapshotFilterSql` `eq ""` arm): `CsvBlankCellsNullSnapshotSpec` `eq ""` case goes red.
- **Revert D4** (`Some(null)` → `field-missing` in all three steps): all three null-as-empty tests go red.

Frontend. The orchestrator asked whether D6/D10a need a proof. They do, and I ran it:
- **D6** (drop `records={filteredPaginationRows}` from PanelContent): 1 red (`MetricOutputPanel.blankCount` "counts 2, not 3").
- **D10a click** (`mapAggregateClickToSelection` always `params.name`): 2 red (unit + `PanelCard.aggregateChart`).
- **D10a Inspect** (predicate back to `String(raw) === value`): 2 red.
- **D10a groupHasNull from rawRows-like data** (`=== null || === ""`): 1 red.
- **D10a strict-null loosened** (`=== null` → `== null`): **survives (all green)**. See suggestion below.

### C2 check (regression rows run through the real CSV loader)

`CsvLoadSupport.loadCsv` writes the CSV text to a temp file and calls the production `InProcessPipelineEngine.loadRows(CsvSource)`, which goes through `loadCsvRowsFromBytes`. Every D7/D7b row in `CsvBlankCellsNullStepsSpec`, the snapshot spec (its own `csvRows` helper, same `engine.loadRows` path), the workspace spec and the AI/filter step-spec additions starts from `loadCsv(...)`. The D1-revert mutation turning them red confirms they really depend on the loader. One test hand-maps the loaded nulls before asserting. See Change Request 1.

### Phase 1: Spec Review — FAIL

- AC1 (red-first count/count_distinct/fillnull): met. The red state was reproduced by mutation; the ordering is unverifiable (see above).
- AC2 (regression suite over the consumer list, asserting the new value deliberately): **mostly met, two gaps**:
  - The upsert "optional numeric" row goes red by accident, not by assertion (CR1).
  - The D7 "join/lookup key" row pins only `join`. `LookupStep` (its own `refRows.groupBy(_.getOrElse(lookupKey, null))` / `refIndex.get(key)` path) is not exercised, although task 3.3 says "every design D7 and D7b row" (CR3).
- AC3 (release note): **not met in the artifacts.** Task 4.1 is ticked `[x]`, but no release-note text exists anywhere in the commit or the change dir (`grep -ril "release note"` hits only planning/skeptic files). Ticking the task before the text exists makes it inaccurate (CR2).
- No AC silently reinterpreted. D1-D10 are implemented as designed (checked line by line: loader `trim.isEmpty → null`, null padding, blank-line skip, `,,` kept; FilterStep D3; AI-step D4; SQL `eq ""` → `IS NULL OR = ''` for every cast; Metric `records ?? rawRows`; `groupHasNull` strict from records on a local spec copy; Inspect predicate).
- `field-missing` wording change (`"is missing or null"` → `"is missing"`) is in-scope. Once null no longer reaches that arm, the old text would be false. The spec deltas (`pipeline-generatetext-op`: "field-missing (input field absent)") match. No test or client pins the old string (grep: 0 hits outside the archived main spec text, which the delta modifies).
- Mixed null / literal-`"null"` group: there is no end-to-end test. The unit tests do cover both halves (click with `groupHasNull` → `""`; Inspect `""` → `[null, ""]` rows, excluding the literal `"null"` row id 5), and design D10 documents the behaviour as accepted. Not blocking.
- No scope creep. Only the planned files plus comment updates changed. Schemas and API shapes are unchanged, as the design states.
- CONSTRAINTS: C2 is honoured except CR1. C3 is honoured (testFull used). C1's ordering cannot be verified (above).

### Phase 2: Code Review — FAIL (minor)

- CONTRIBUTING [mechanical] Imports & Qualifiers: no inline FQNs introduced (checked all diff hunks).
- **Readability:** `backend/src/main/scala/com/helio/domain/steps/ConvertFormatStep.scala:58-59`. The new comment and `case Some(null) => ""` are indented two columns deeper than their sibling `case` arms (`case None  =>` at :57 also has a stray double space). The neighbouring `case` columns in AnalyzeWithAiStep/GenerateTextStep are now misaligned too, but those are cosmetic. :58-59 is a real mis-nesting at a glance (CR4).
- Type safety: `null: String` in the loader is deliberate and documented. Rows are `Map[String, Any]`, as before.
- Security: the SQL `eq ""` arm binds `$column` (no interpolation into SQL text). Safe.
- Error handling: an absent field still fails loud. A null field becomes "" by design.
- Tests are meaningful (mutation table above), with the exceptions in CR1/CR3 and the strict-null gap below.
- No dead code, no TODO/FIXME, no over-engineering.
- Test comments: `FilterStepSpec.scala` (new block, ~:211-219) uses trailing comments that restate each assertion (`// matches the blank`, `// excludes the blank`). CONTRIBUTING says "no restating an assertion in prose". This is a judgment rule, so it is a non-blocking suggestion.

### Phase 3: UI Review — PASS

Servers started by `start-servers.sh` at 18:23 from this worktree (pids for :9747/:6840 have cwd under `HEL-1408/backend` and `HEL-1408/frontend`). `assert-phase.sh servers` passed. I logged in fresh as a new user (not matt@helio.dev) on the shared browser.

- CSV `team,score,note` with an empty, a whitespace-only (`"  "`) and blank numeric cells, sent through `POST /api/first-run/dashboard`. The snapshot rows hold JSON `null` for every blank, including the whitespace-only team. The table renders `—`. `GET /api/outputs/:id/distinct-values?column=team` returns only `a`, `b`.
- **D10 end to end on a CSV-sourced, client-aggregated chart** (Output config `aggregation: {groupBy: team, agg: count, yField: note}`). Bars are `a`, `b`, `null`. Clicking the `null` bar opens Inspect "Showing rows for team: / count(note)" listing exactly the 2 blank-team rows (z, v). "Filter dashboard by team =" sets the cross-filter to `""`. The network shows `GET /api/outputs/<table>/rows?...filter={"ops":[{"column":"team","op":"eq","value":""}]}` → 200. The sibling table shows exactly the 2 blank rows ("2 results match the dashboard filter"), and the pre-aggregated top-team sibling shows its 1 null-group row. Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1408/evidence/.playwright-mcp/hel1408-eval1-chart.png`, `/home/matt/Development/helio/.concertino/runs/HEL-1408/evidence/.playwright-mcp/hel1408-eval1-blank-crossfilter.png`. The cross-filter result is confirmed by the request URL and the row text, not only by the screenshots.
- A non-blank click (`a`) cross-filters normally ("Filter dashboard by team = a", siblings narrow).
- Metric `count(score)` over 6 rows with 2 blank scores shows `4`.
- Console: 0 errors from :6840 during the flows. The 4 errors in the shared log are from another session's :6848. The only warnings are ECharts "Can't get DOM width" during breakpoint resizes, which predate this change.
- Breakpoints 1440 / 768 / 375: no horizontal overflow, and panels reflow to full width (704 / 311 px).
- Accessibility: the blank selection's button reads "Filter dashboard by team =" (empty value). This is the documented `(blank)`-label follow-up, not a defect of this change.

Dev-DB rows created (for cleanup, exact ids):
- user `43b88471-30f9-45a6-8886-ce19c0d44b3e` (`eval-hel1408-c1-1791509061@example.com`)
- data source `90155454-9125-4a07-aaf5-c80c652b1d85` (upload `csv/90155454-9125-4a07-aaf5-c80c652b1d85.csv`)
- pipeline `5bab0968-25f2-40ac-911b-c9d21452494c`
- dashboard `13f4973b-f801-4059-9b00-4b931e8dc353`
- outputs `eb44fd6e-1797-4885-8c1f-a8b8a09cfa9e`, `fae4b707-7d8a-4631-ae21-1cf09cfe4ff7`, `33651600-15f3-4092-98e2-cd4803fc1e73`, `87d6b99c-e6ed-4355-8716-31de565d86b7`
- panels `04e5e594-956f-4e69-a0ff-00b941164fa3`, `2943aaef-9f19-4e52-a0d8-c972659e0c8f`, `e0d4390e-c431-42d9-8dbf-d0fb3d9ff692`, `d87c2e13-d660-4739-9877-e348610992e3`

### Overall: FAIL

### Change Requests

1. **`backend/src/test/scala/com/helio/domain/engine/CsvBlankCellsNullStepsSpec.scala:223-230`: the "accept a blank in an optional numeric column" test is red by accident.** Under the D1 revert it fails with `java.lang.NumberFormatException: For input string: ""` thrown by the test's own `s.toInt` (:227), not by `DatasetRowValidator`. It also hand-maps cells (`case null => JsNull`), against C2's intent. Rewrite it so the old behaviour fails at the assertion. For example, feed only the blank `score` cells through the same `toRow`/`PipelineRowJson.anyToJsValue` conversion the other upsert cases use (`frame.filter(_("score") == null).map(toRow(_, Vector("score")))`) against an optional `IntegerType` declaration, and assert `isRight`. Under the old loader the cell becomes `JsString("")`, which the validator rejects, so the test goes red on the assertion.
2. **Task 4.1 / AC3: the release note does not exist.** Either write the user-facing release-note text into the change dir now (e.g. `openspec/changes/csv-blank-cells-as-null/release-note.md`, or a clearly marked section of `files-modified.md`), covering everything 4.1 lists (every D7/D7b change, D10 incl. scope beyond CSV and `/rows` `eq ""`, Q1-Q8, `= ""` compat, AI-step null-as-empty, snapshots keep `""` until the next run, `is null`/fillnull guidance), so the orchestrator can paste it into the PR body. Or untick 4.1 until that is done. A ticked task with no artifact is an inaccurate plan record.
3. **D7 "join/lookup key" row: add the `lookup` half.** In `CsvBlankCellsNullStepsSpec`, add a `LookupStep` case over two `loadCsv` frames (left `team` blank, reference `team` blank with a label). Assert that the blank-key left row is enriched from the blank-key reference row, and that the D1 revert turns it red. Task 3.3 promises every D7 row, and `LookupStep` keys through its own `groupBy`/`Map.get(null)` path, separate from `JoinStep`.
4. **`backend/src/main/scala/com/helio/domain/steps/ConvertFormatStep.scala:57-59`: fix indentation.** Align the comment and `case Some(null) => ""` with the other `case` arms, and drop the double space in `case None  =>`.

### Non-blocking Suggestions

- Pin design D10a's strict `=== null`. Mutating `ChartOutputPanel.tsx`'s `records.some((r) => r[groupBy] === null)` to `== null` leaves every test green. A `ChartOutputPanel.aggregate` case with absent-key records (no nulls) and a literal `"null"` group, asserting `groupHasNull: false`, would pin it.
- `CsvBlankCellsNullSnapshotSpec` `eq ""` covers `AsText`/`AsNumeric`. Add `AsTimestamp` to back the "for every cast" claim in its name and in the spec delta.
- `FilterStepSpec` new block: drop the trailing comments that restate each assertion (CONTRIBUTING, Tests).
- Persist the executor's red-first and mutation outputs under the run's evidence dir (or `files-modified.md`) in future cycles, so C1/3.9 can be audited without a re-run.
- Observation, out of scope: the Inspect dialog grid renders a null cell as empty (not `—`), and the upload response's `inferredSchema` reported `nullable:false` for `score` even though it had a blank cell. Neither is touched by this diff. File follow-ups if they matter.
