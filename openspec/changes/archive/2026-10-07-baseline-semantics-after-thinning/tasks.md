## Standing Constraints

- [C1] Thinning never deletes an Output's newest 101 history points (101 = alert rolling_avg max n 100 + 1, derived from one shared constant, fixed, no env var); the tier max-age purge still deletes protected points older than the cap.
- [C2] Window compares keep owner ruling D6 (nearest surviving point at or before latest minus window) unchanged in code; docs state the up-to-one-bucket-width slack.
- [C4] Proof fixture: fixed bucket-aligned now with the newest two points in one 5-min bucket; distinct per-point values readable by both headline and summaryValue; the triggering run's own point is the newest; deterministic breach; red proof reverts ONLY the SQL recency predicate (never a compile failure).
- [C3] The proof test thins a real DB fixture via OutputHistoryRepository.thinAndPurge, then asserts BOTH the compare-API previous_run baseline and the alert previous/rolling_avg baseline equal the literal previous / n most recent runs; it must be shown red against the pre-change thin SQL.
- [C5] After the Phase-3 archive (main specs change only via their MODIFIED deltas), a case-sensitive grep of schemas/, openspec/specs/, helio-mcp/src, frontend/src (excluding openspec/changes/archive and this change dir) for the superseded previous_run wording ('RETAINED point', 'not necessarily the immediately previous', 'second-newest retained') shows zero hits; the History scrubber's accurate lowercase 'retained point' text is out of scope; every main spec whose text is contradicted gets a MODIFIED delta.

### Backend

- [x] 1.1 Add `com.helio.domain.history.HistoryBaselineLimits` (`MaxRollingN = 100`, `ProtectedNewestPoints = MaxRollingN + 1`); make `HistoryBaseline.MaxRollingN` alias it
- [x] 1.2 `OutputHistoryRepository.thinAndPurge`: add `protectedNewest: Int = HistoryBaselineLimits.ProtectedNewestPoints`; nested thin subquery — inner per-output recency `row_number()` (captured_at DESC, id DESC), outer bucket rank over `recency > $protectedNewest` rows only, delete `rn > 1` (bound param); age purge untouched and first; update the `PipelineSchedulerServiceMaintenanceHooksSpec` override signature
- [x] 1.3 Update `HistoryThinningPolicy` / `thinAndPurge` / `OutputHistoryService.resolveBaseline` scaladoc to state the guarantee and the window slack

### Frontend

- [x] 2.1 `compareOptions.ts`: `CHART_COMPARE_OPTIONS` offers Previous (same list as metric); update its doc comment
- [x] 2.2 `metricHistoryView.ts`: fix the stale `compareLabel` comment (label text unchanged)

### Docs

- [x] 3.1 CLAUDE.md `GET /api/outputs/:id/history` entry: replace the "previous _retained_ point" sentence with literal-previous + window slack
- [x] 3.2 `backend/src/main/scala/com/helio/api/routes/alerts/README.md`: document previous / rolling_avg semantics under thinning
- [x] 3.3 helio-mcp `src/tools/outputs.ts`: `COMPARE_CONFIG_DOC` and `get_output_history` description match the new semantics

### Tests

- [x] 4.1 Existing `OutputHistoryRepositorySpec` thin cases pass `protectedNewest = 0` (intent preserved, expectations unchanged)
- [x] 4.2 `OutputHistoryRepositorySpec`: small-K case proving the recency boundary (newest K kept, K+1th thinned) and age cap overriding protection
- [x] 4.3 New DB-backed spec per design D7: Output A 111 one-minute points (point 0 = triggering run, distinct values) → real `thinAndPurge` → points 0..100 survive, straddling bucket keeps its newest older point; compare `previous_run` = point 1; alert `previous` = point 1 and `rolling_avg n=100` = mean(1..100) via persisted event `value.baseline`; Output B age cap beats protection; Output C >101 points over 40 days
- [x] 4.4 Red proof: revert ONLY the SQL recency predicate (signature/constant/specs kept), record 4.3's failing (a)-(c) assertions; also a K=100 run with (a)'s exact survivor set failing; keep full logs
- [x] 4.5 Check any other spec seeding thinnable history (`OutputHistoryRetentionServiceSpec`, scheduler hooks, `RetentionLockGuardSpec`) still asserts its original intent; adjust via `protectedNewest`, never by changing expectations
- [x] 4.6 Frontend tests: chart compare options include Previous; selecting it saves `previous_run` (`OutputEditorSheet.compare.test.tsx`, compareOptions tests)
- [x] 4.7 helio-mcp tests that pin the description strings updated

### Design-gate notes (skeptic-design-2, non-blocking)

- [x] 5.1 `OutputHistoryRetentionServiceSpec.scala:177` ALSO overrides 3-arg `thinAndPurge` (compile fix), and its `historyCount(oF) shouldBe 1923` (:85) needs the `protectedNewest` service-constructor route set to 0, not re-seeding
- [x] 5.2 Docs say "never deletes the newest 101" (in practice >= 102 survive), never "keeps exactly 101"
- [x] 5.3 Forty-days coverage: seed one free-tier AND one owner-tier Output with >101 points (or state which half is covered where)
- [x] 5.4 Fixture summaries carry `v: 1` plus `metric.value` (else `headline` is None and (b) fails for the wrong reason); compute expected survivor sets from the real bucket math, do not copy design.md's illustrative numbers

### Final-gate notes (skeptic-final-1)

- [x] 6.1 Schemas `baseline.description` (both history response schemas) rewritten to the ruled semantics
- [x] 6.2 MODIFIED deltas for `mcp-output-tools` (get_output_history) and `output-snapshot-history` (History repository primitives)
- [x] 6.3 [C5] case-sensitive grep for the superseded previous_run wording: zero hits post-archive (verified at Delivery); 6 case-insensitive "retained point" hits in the History scrubber spec/components (output-history-scrubber/spec.md:9,46; HistoryScrubber.tsx; useOutputHistoryView.ts; OutputHistoryModal.tsx) are accurate and out of scope
