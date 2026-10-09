## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `78fd8575a04806c7f84b301749000f3244418783` (unchanged from the start of the review to the end).
Diff base, resolved live with `resolve-review-base.sh` (exit 0): `3d63a1751bcfd09595943ce390f8f10678e44e49`.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/csv-blank-cells-null/HEL-1408`.

### What I verified (with evidence)

**Production diff, read in full.** It is small:
- `InProcessPipelineEngine.loadCsvRowsFromBytes`: a cell whose trimmed value is empty becomes null, short rows pad with null, and blank or whitespace-only lines are skipped.
- `FilterStep` D3.
- AI/text steps D4.
- `NodeSnapshotFilterSql` `eq ""` arm.
- `MetricOutputPanel` records.
- `ChartOutputPanel` `groupHasNull` plus `chartClickSelection` D10a.
- Comment-only edits in `SchemaInferenceEngine`, `chartOverlay.ts` and `PanelInspectView`.

I grepped `parseCsvLine|padTo(headers|loadCsvRows` across `backend/src/main/scala`. `loadCsvRowsFromBytes` is the only run-path CSV row loader, called once from `csvRowsWithinLimits`. Inference, preview and the classifier use `parseRfc4180Row`, which is untouched. The design's single-choke-point claim holds.

**AC1, red-first count/count_distinct/fillnull: MET.**
- `CsvBlankCellsNullSpec` loads rows through the real loader (`CsvLoadSupport.loadCsv` → `InProcessPipelineEngine.loadRows(CsvSource)`).
- I ran my own mutation in a `git archive` scratch copy outside the repo, removed afterwards, reverting D1 to `padTo(headers.size, "")` with no line skip. Result: 33 failed, 20 passed across `CsvBlankCellsNull{,Steps,Snapshot,Workspace}Spec` and `FilterStepSpec`.
- Both AC1 cases went red: "count and count_distinct exclude blank cells" and "fillnull constant fills blank cells".
- Temporal ordering (C1) cannot be shown from the artifacts, as evaluation-1 already disclosed. The red state is reproduced, and I am not relying on any mtime ordering.

**AC2, deliberate regression suite over the consumer list: MET.**
- `CsvBlankCellsNullStepsSpec` pins each D7/D7b row from a CSV-loaded frame. The rows covered are:
  - aggregate, groupby and pivot
  - fillnull ×3
  - cast and compute
  - stringops (unchanged)
  - sort, window and dedupe
  - join and lookup
  - assert notNull/unique/rowCountMin/regex
  - upsert required/default/optional-numeric
  - Output schema timestamp and summary count
- `CsvBlankCellsNullSnapshotSpec` covers the stored JSON null, distinct-values, row count, NULLS LAST and `eq ""`. `CsvBlankCellsNullWorkspaceSpec` covers `nullRate`.
- Every one of them went red under my D1 revert, so the assertions are deliberate, not accidental.
- The ticket asks for "history summaries" coverage, which the summary-count case in the steps spec provides.

**AC3, release note: MET.** `release-note.md` exists and is accurate against the code and against my live probes:
- `!= ""` drops null
- compute `concat` → null
- `fillnull` fills
- dedupe on a null key
- NULLS LAST
- timestamp inference

**Owner rulings Q1–Q8.** I read them from `.concertino/runs/HEL-1408/events.jsonl` line 4 (8 sub-questions); line 7 answers all 8 as "rec". Every ruling holds in the running app:
- Q1 (whitespace → null): the `"   "` note cell is JSON `null` in the snapshot.
- Q2 (skip blank lines): the 8-line CSV with 2 blank lines gives `lastRunRowCount: 6`.
- Q3 (filter compat): live step preview of filter `note != ""` returns 3 rows, with nulls excluded.
- Q4 (null-as-empty): verified by code read plus the evaluator's mutation; the specs pass in my run.
- Q5 (compute propagates null): live preview of `concat($team,"-",$note)` gives `null` wherever either input is blank.
- Q6 (`—` render): screenshots below.
- Q7 (`"null"` label): unit tests pass. On a pipeline-aggregated chart the label is still empty, the same as before the change.
- Q8 (timestamp inference): live `/api/workspace/context` types `when` as `timestamp` on every Output.

**Gates, re-run by me:**
- `nice -n 19 sbt testFull`: `Total number of tests run: 6361 … Suites: completed 455, aborted 0 … succeeded 6361, failed 0, canceled 4 … All tests passed.` EXIT=0.
- Targeted `testOnly` of the 8 HEL-1408/step suites: 160/160.
- Frontend `jest --maxWorkers=3`: `Test Suites: 477 passed … Tests: 5028 passed`.
- `typecheck`, `lint` and `format:check` all clean.
- I also ran my own frontend mutation in a scratch copy, removed afterwards: `mapAggregateClickToSelection` reverted to `params.name`, and `records=` dropped from `PanelContent`. 3 tests went red: the D10a unit test, the D10a `PanelCard` test and the D6 `MetricOutputPanel` "counts 2, not 3".

**End-user probes on the running app.**
- `assert-phase.sh servers` passed on 6840/9747.
- I used a fresh user and logged the shared browser out first. It had been logged in as an earlier evaluator user.
- I uploaded `team,score,when,note` with these blanks: empty, whitespace-only, missing trailing cell, plus two blank lines.
- **First-run dashboard** (`POST /api/first-run/dashboard`): builds and runs (6 rows). The table renders `—` for every blank, in dark and light themes. The time-series puts the null date as the last, unlabelled point; before, `""` sorted first. The top-n chart shows the blank team as an unlabelled bar, as before. No new console errors; the only error was the pre-existing `/schedule` 404 for a pipeline with no schedule.
- **Persona templates:** `finance.csv`, `founder.csv`, `ops.csv` and `streamer.csv` have 0 blank cells, 0 short rows and 0 blank lines (python `csv` scan). Template dashboards are unaffected.
- **Step preview / dry run across step types on CSV blanks**, run live:
  - stringops upper, compute, window lag, fillnull, cast integer/boolean, dedupe, aggregate count/count_distinct/median, datebucket and filter all return 200 with correct null semantics.
  - Window lag orders the null `when` last.
  - Dedupe collapses the 2 null teams into 1 row.
  - Aggregate `n` excludes null notes, and `count_distinct(team)` is 0 for the null group.
  - Dry run `POST /run?dry=true` returns 200.
  - Nothing throws on null. I also checked by code read that `SplitText`, `ChunkByTokenCount` and `ExtractHeadings` already handle `Some(null)`, and `DateBucket` guards null.
- **Pipeline-editor "Preview data" UI** renders `—` for the blank cells.
- **Server Output reads:**
  - `sort=when:desc` puts null last.
  - `filter eq ""` on `note` returns exactly the 3 null-note rows.
  - `distinct-values?column=note` omits the blank.
- **Assistant grounding** (`/api/workspace/context`): `nullRate` reflects the blanks (team 0.333, note 0.5), and examples and distinct counts exclude them.
- helio-news (read-only grep): no `"value": ""` filter and no `count_distinct`. This matches design D8.

**Screenshot evidence** (persisted via `persist-evidence.sh`):
- `/home/matt/Development/helio/.concertino/runs/HEL-1408/evidence/.playwright-mcp/sk1408-final-firstrun-viewport.png` (dark: table `—`, time-series)
- `/home/matt/Development/helio/.concertino/runs/HEL-1408/evidence/.playwright-mcp/sk1408-final-topteam.png` (dark: top-n chart with the blank bar)
- `/home/matt/Development/helio/.concertino/runs/HEL-1408/evidence/.playwright-mcp/sk1408-final-firstrun-lighttheme.png` (light parity: table `—`)
- `/home/matt/Development/helio/.concertino/runs/HEL-1408/evidence/.playwright-mcp/sk1408-final-cast-preview-data-light.png` (step preview `—`)

**UI/design judgment.** The diff adds no new visual surface. It changes only data flow: the click value, the metric records and the Inspect predicate. `—` is the existing `DataGrid` null glyph, and it looks consistent between the dashboard table and the step preview in both themes. There are no token or component concerns.

### Verdict: CONFIRM

### Non-blocking notes
- The `csv-blank-cell-null` spec delta scenario "All-blank column infers as before" says the column "is uploaded … inferred as a nullable `string`". The engine (`fromCsv`) does infer nullable. However, the live upload response and stored schema report `nullable:false` even for an all-blank column (source `e0a04cd5-…`), because `DataSourceService` stores `SchemaField` with no nullability. This is pre-existing and not touched here. Consider rewording the scenario to "schema inference returns", or file a follow-up.
- Pre-existing, now more visible: Output and source schemas report `nullable:false` while the grounding shows `nullRate > 0` for the same column. Follow-up candidate for assistant grounding consistency.
- The time-series ordering of a null x moves from first (`""`) to last. This is covered by "sort … blanks last" in the release note.
- The evaluator's open suggestions still stand (an `AsTimestamp` `eq ""` case, and `FilterStepSpec` trailing comments). They are cosmetic.
- No gate defect: I accepted no mtime-ordering claim.

### Dev-DB rows created by this review (exact ids)
- user `ffb33a9d-14a9-40dc-b0a8-da598b1c1fbd` (`skeptic-hel1408-1791511362@example.com`)
- data sources `a61c7fa1-badd-44cd-88be-f7ed8d3fd031` (upload `csv/a61c7fa1-badd-44cd-88be-f7ed8d3fd031.csv`) and `e0a04cd5-94b8-4a72-99d2-1adb574475ab` (upload `csv/e0a04cd5-94b8-4a72-99d2-1adb574475ab.csv`)
- pipelines `1845adf0-aa79-4354-bba5-6452ea70c714` (first-run), `8224df9d-ab68-4364-95e8-a6ed7f356f73` (probe), `9021266f-8d51-4ae6-8c2e-6ee25b6b911d` (probe2; dry-run `51e9de19-6aa0-45dd-a391-a466c3bd97a9`)
- dashboard `94747c99-ba1f-4f5b-9b08-29c07a90933f`
- outputs `c673d490-e175-43a4-ac22-7fd87ea08f54`, `be4ab6ee-3444-49ae-8d93-8dbb33601e0f`, `951d4456-2eb0-460a-8d67-e287138e83f3` (plus that dashboard's 3 panels)
