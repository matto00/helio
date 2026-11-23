## Standing Constraints

- [C1] Every test in group 2 is red first and its red run is committed as .txt before the matching fix; a test that could pass by chance (random ids, clock collisions, the 24 h retention window) does not count as red.

## 1. Backend

- [x] 1.1 Runs order `started_at DESC, id DESC` in `listByPipeline`, `listByPipelineInternal`, `latestRunInternal`, `latestNonDryRunInternal`, `latestRunIdsInternalBatch`
- [x] 1.2 Same tie-break in `deleteOldRunsInternal` (`newestN`, `capped`) and `deleteOldDryRunsInternal` (`keepIds`)
- [x] 1.3 Reaper `NOT EXISTS` uses `(n.started_at, n.id) > (r.started_at, r.id)`
- [x] 1.4 `HomeSummaryRepository.load` orders `r.started_at DESC, r.id DESC`
- [x] 1.5 Map `created_at` on `PipelineRunAssertionTable` (outside `*`) or use plain SQL; assertion reads (`listAssertionsByRun`, `listAssertionsByRunInternal`, `listAssertionsByRunsInternalBatch`) order `created_at ASC, id ASC`
- [x] 1.6 `insertAssertions` writes ids `<batch UUID>-<5-digit index>`; grep confirms nothing parses assertion ids as UUIDs
- [x] 1.7 Comments at each site say the id tie-break is deterministic, not "more recent"
- [x] 1.8 Record `EXPLAIN (ANALYZE)` for `latestRunInternal` / `listByPipelineInternal` before and after; index only if measured regression

## 2. Tests

- [x] 2.1 Repository spec: two same-`started_at` runs, both insertion orders, for each run read in 1.1 (red first, committed as .txt)
- [x] 2.2 Retention and reaper specs with tied `started_at` at the boundary, older than the 24 h window (or via the `capped` path) so the test is not vacuous (red first)
- [x] 2.3 Assertion read specs: same-`created_at` rows inserted in non-id order read back in `id` order; insert order preserved for new rows using 8+ rows (red first)
- [x] 2.4 Route-level (red first): run-history, runs/latest and context-details agree on the latest run with a tie
- [x] 2.5 RLS-context reads (`listByPipeline`, `listAssertionsByRun`, Home summary) proven on `helio_app_test` (`rolbypassrls = false`)
- [x] 2.6 Mutation: remove each tie-break and revert D2 ids to `UUID.randomUUID()`, confirm the matching test goes red; record results
- [x] 2.7 helio-mcp goldens (HEL-1619/1625) unchanged: run the helio-mcp golden tests, no golden file diff (regression check only; fixture-served, not ordering evidence)
- [x] 2.8 Full spec files for every touched spec; backend shards via `sbt testFull` under the timeout

## Evidence

- Red: `red-run-1.txt` (superseded: route test had a test bug), `red-run-2.txt` (authoritative, against unfixed main code). Both committed before the fix.
- Note on red: a test inserting in the order the un-tie-broken query happens to return passes by luck; the other insertion order is the red. The 12-row insertAssertions test passes on the old code for ORDER only (heap order == evaluation order); it is red via the id-format assertion and via mutation M14/M15.
- Mutations: `mutations.txt` (15 mutations, each red; M04-M08 re-recorded in cycle 2 with the real failing tests and a diff of each mutated line, after cycle 1 had M05-M08 shifted one site). EXPLAIN: `explain-analyze.txt` (no V147 index needed).
