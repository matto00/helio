## Standing Constraints

- [C1] Never claim the composed spec proves current-run exclusion unless the read-after-write ordering is forced deterministically; report the M4 mutation red rate as measured.
- [C2] D3b armed-wait outcomes are swallowed by production recover layers; record satisfied/timedOut and assert satisfied>=1, timedOut=0 before alert assertions and on every M4 red.

## 1. Investigate

- [x] 1.1 Record the D2 sequencing evidence (PipelineRunService.scala writesChain ~1628-1636, publishTerminalAfter ~997-1003, success-branch followUp.map) in mutation-evidence.md. No `eventually`, no sleeps.
- [x] 1.2 Seed `amount` as JSON numbers (D3; never string cells): run 1 sums to 30, run 2 to 100; baseline rule `gte 50` abs.

## 2. Spec

- [x] 2.1 Add `backend/src/test/scala/com/helio/api/ApiRoutesAlertHistoryWiringSpec.scala` extending `HelioRouteTest`, constructing `ApiRoutes` per D1 (alert repos + history repo passed as Main passes them; never constructing AlertEvaluationService/PipelineRunService itself).
- [x] 2.2 Seed fixture per D3; two runs through the real run route with different data (D4).
- [x] 2.3 Add the test-only `ReadAfterWriteHistoryRepo` (D3b) and pass it as ApiRoutes' `outputHistoryRepo`; it records satisfied/timedOut per armed wait; disarm before GET-history reads.
- [x] 2.4 Before run 2's alert assertions, assert the D3b precondition (satisfied ≥ 1, timedOut = 0). Assertions per D5: history row after run 1 (via the route), threshold rule fires, baseline rule exactly one event (counted per rule id) on run 2 with baseline = run-1 value.
- [x] 2.5 Green on main: run the spec 3x consecutively with `nice -n 19 sbt "testOnly com.helio.api.ApiRoutesAlertHistoryWiringSpec"`.

## 3. Mutation proof

- [x] 3.1 M1 (history repo not passed to AlertEvaluationService): red; record transcript; revert.
- [x] 3.2 M2 (alert service not passed to PipelineRunService): red; record; revert.
- [x] 3.3 M3 (history repo not passed to PipelineRunService): red; record; revert.
- [x] 3.4 M4 (measurement, D6): drop the `filterNot` at HistoryBaseline.scala ~97; run the spec 5x; record red count; revert. Each red transcript must show the D3b precondition held. With D3b in place 5/5 red is expected; if not, follow D5's honesty rule.
- [x] 3.5 Write `openspec/changes/alert-history-wiring-spec/mutation-evidence.md` with the four transcripts; confirm `git diff main -- backend/src/main` is empty.

## 4. Gates

- [x] 4.1 Backend: `sbt testFull` (or at minimum the alert/history/api specs + the new spec) and the pre-commit hooks pass without bypass.
