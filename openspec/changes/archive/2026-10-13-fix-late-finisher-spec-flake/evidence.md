# HEL-1544 evidence

All runs: `cd backend && nice -n 19 sbt "testOnly com.helio.services.pipelines.LateFinisherRunSpec"` (foreground, single forked group).

## 1.1 Baseline (unmodified spec)
`Tests: succeeded 10, failed 0` (13.9 s). Green, consistent with "passes locally".

## 1.2 Probe A (terminal write forced to commit BEFORE the hook's delete) -- RED, CI signature
Temporary probe (removed before commit): `GatedRunRepo.updateRunTerminal` did `.andThen { case _ => probeCommitted.trySuccess(()) }`; the unfixed D7 test's hook became
`beforeOutputList = () => probeCommitted.future.flatMap(_ => deletePipeline(fx))` (env `PROBE=A`).
```
[info] - should answer 404, write nothing and publish no succeeded when its pipeline was deleted before the Output list was read *** FAILED ***
[info]   Right(RunResultResponse(Vector({"label":"a","amount":"1"}, {"label":"b","amount":"2"}, {"label":"c","amount":"3"}), 3, Map("0630bcd8-..." -> 3), 3, Some("45ab99c1-..."), false, None, false, None, None, Vector())) was not equal to Left(NotFound("Pipeline not found: ac368da0-...")) (LateFinisherRunSpec.scala:214)
[info] Tests: succeeded 9, failed 1
```
Identical to the CI failure (`Right(RunResultResponse(... 3 rows ...))` vs `Left(NotFound(...))`).

## 1.3 Probe B (delay the hook's delete 1500 ms, unfixed test) -- RED, same signature
`beforeOutputList = () => Future { Thread.sleep(1500) }.flatMap(_ => deletePipeline(fx))` (`PROBE=B`):
`Right(RunResultResponse(... 3 rows ...)) was not equal to Left(NotFound(...))`, `Tests: succeeded 9, failed 1`.

H1 CONFIRMED. The run's own eager `succeeded` UPDATE wins (won = true), the later DELETE cascades the run away, the Output list reads empty, `failIfLostTerminalWrite` is a no-op, result `Right`. Why `Right`: the delete landed before the Output list read, so the list was empty and no node guard ran; `won=true` then decides and `failIfLostTerminalWrite` is a no-op. This is NOT a general "a won run always succeeds" guarantee: if the delete lands after the Output list read (item-2 window), a node guard sees the run Missing and the same won run answers 404 with no `succeeded` (skeptic's probe; now pinned by a test, see 2.3). HEL-1518 D7 defines only the lost-write path, and never promised 404 for a run that already won. ROOT CAUSE: TEST-ONLY (the D7 delete test did not sequence the delete ahead of the eager terminal write, unlike the reap tests which use `terminalGate`). No production defect.

## 1.4 H2 (cross-test / cross-spec reap leakage)
Each spec boots its own embedded Postgres: `OutputHistoryApiHarness.scala:69` `embeddedPostgres = VerifiedEmbeddedPostgres.start(...)` in `startHarness()` (called from this spec's `beforeAll`), so `HEL924_TEST_GROUP_CONCURRENCY=2` groups do not share a DB and another spec's global `reapStaleRunsInternal` cannot touch this spec's runs. Within the spec, a reap of this spec's run yields `Conflict`, never `Right`; and the D7 reap test's detached future runs after the delete test (declaration order). The interleaved WARNs in HEL-1558's log are just stdout interleaving of neighbouring tests (visible in the baseline log too). H2 does not produce the observed signature.

## 2.2 Sibling audit
- Item-2 "deleted in that window" test (hook = `beforeNodeFold`): probe C (delete delayed 1500 ms) -> `Tests: succeeded 10, failed 0`; probe D (delete forced after terminal write committed) -> `Tests: succeeded 10, failed 0`. NOT exposed: the hook fires after the Output list, every node guard runs after the delete commits and sees the run Missing whichever order the terminal write takes, so 404 either way. Left unchanged.
- Item-1 tests (`afterEngine`, lines ~163/172): act before the success chain (and its eager terminal write) starts; not exposed.
- Item-2 / D7 reap tests already hold `terminalGate` until the reap.

## 2.1 Fix
D7 delete test: `terminalGate` = promise completed by `deletePipeline(fx).andThen { case _ => deleted.trySuccess(()) }` (success or failure). With probe B's 1500 ms delay re-applied to the FIXED test: `Tests: succeeded 11, failed 0` (green, deterministic).

## 2.3 D5 positive pins: ADDED (cycle 2: renamed, own describe block, bounded poll)
New describe block "a run whose own succeeded terminal write committed before its pipeline was deleted (HEL-1544)" (no longer under the "terminal write loses" block), two tests, both deterministic via `terminalWritten`:
1. "answer success and publish succeeded when the delete also landed before the Output list was read, so no node guard runs" -> `Right`; the `succeeded` event is awaited with a bounded 15 s poll (`awaitSucceeded`), not the fixed 300 ms settle.
2. "still answer 404 and publish no succeeded when the delete landed after the Output list was read, because a node guard sees the run Missing" -> the item-2 asymmetry (same won run, delete in `beforeNodeFold`): `Left(NotFound)`, nothing written, no `succeeded` (absence checks keep the settle window).
Run: `Tests: succeeded 12, failed 0`.

## 2.3b Mutation M8 (pin non-vacuity)
`failIfLostTerminalWrite` temporarily changed to not short-circuit on `won` and to accept `Terminal if won` only, so `Missing` fails even for a won run (reverted via `git checkout`): the success pin went RED (`Tests: succeeded 11, failed 1`); the 404 pin stayed green, as expected.

## 3.1 Mutation M6
`failIfLostTerminalWrite` body replaced with a no-op (`if (true) Future.unit else ...`, temporary, reverted via `git checkout`):
```
- should answer 404, write nothing and publish no succeeded ... deleted before the Output list was read *** FAILED ***   (Right(RunResultResponse(...)))
- should answer 409 and publish no succeeded when the run was reaped after its last node write *** FAILED ***
Tests: succeeded 9, failed 2
```
The fixed D7 test still guards D7.

## 3.2 Repeat under load
Load: 3 x `timeout 300 nice -n 19 sh -c 'while :; do :; done'` (3 busy loops), with `HEL924_TEST_GROUP_CONCURRENCY=2` exported. NOTE: that variable only relaxes the ForkedTestGroup limit (build.sbt:200-208) and is inert for a single-spec `testOnly`; it is NOT CI-like here. The robustness proof is the deterministic probe B on the fixed test (above). 10 consecutive runs: all `Tests: succeeded 11, failed 0, canceled 0`.

## 3.3 Gates
`npm run check:scala-quality` -> `Scala code-quality check: clean (251 soft warning(s))`, exit 0 (spec is 364 lines; pre-existing soft-budget warning). Pre-commit hook runs on commit.
