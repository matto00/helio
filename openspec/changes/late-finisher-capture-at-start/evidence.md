# Evidence — HEL-1565 (late-finisher seam isolation)

All runs: `cd backend && nice -n 19 sbt "testOnly <specs>"`, foreground, one sbt at a time. Executed counts are the sbt
`Total number of tests run` / `Tests:` lines (C3), not exit codes.

## D1 — hazard re-derived on base 27a30bb97 (code-cited)

Seams in `LateFinisherSpecBase.scala` that dereferenced per-test mutable state AFTER an async boundary (original line numbers):
- `GatedRunRepo.updateRunTerminal` l.84: `.andThen { case _ => terminalWritten.trySuccess(()) }` (gate captured at l.82, promise not).
- `HookSnapshotRepo.overwriteRowsWith` l.98-102: `nodeWrites` (shared `val AtomicInteger`, reset by `set(0)`), `foldDone`, `afterNodeWrite` read inside `.flatMap`.
- `HookBackend.execute` l.55: `afterEngine()` read inside `.flatMap`.
- NOT affected: `HookOutputRepo` (l.64-67 reads+clears `beforeOutputList`/`beforeNodeFold` into locals at call start), `HookBinaryRepo` (l.111 reads `binaryTarget` at call start; `beforeBinaryWrite()` is invoked synchronously at call start in the argument-less `flatMap` head).
  (`binaryTarget` was not reset by `afterEach`; now reset in `resetSeams()`.)

No PASSING test leaves a seam call in flight (checked, not restated):
- `PipelineRunSucceededWrites.scala` l.277-286: the success `chain` for-comprehension awaits `materializedWrites`, `binaryRefsUpsert`, `alertEvaluation`, `updateRun`, `updateMeta`, `assertionsInsert`, `baselineUpsert`; `publishTerminalAfter` (l.302) waits for the chain.
- Failure path: `PipelineRunDeletedRecovery.recover` l.33-38 `settle(siblings)` (all of them, incl. `updateMeta` which depends on `updateRun`) before answering.
- `andThen` futures complete only after the callback ran, so the terminal-write signal is also done.
- So the live path is a FAILED / TIMED-OUT test (`submitWith`'s 60 s `Await`, `awaitDb`): its chain keeps running into the next test's state. No production defect found (C2 respected: no `backend/src/main` change).

## Red-first on the unfixed seams (only `resetSeams()` factored out; spec added)

```
[info] - should complete its own test's terminalWritten, not the next test's (GatedRunRepo) *** FAILED ***
[info]   false was not equal to true (LateFinisherSeamIsolationSpec.scala:43)
[info] - should run its own test's afterEngine hook, not the next test's (HookBackend) *** FAILED ***
[info]   false was not equal to true (LateFinisherSeamIsolationSpec.scala:64)
[info] - should advance its own test's node-write counter, not the next test's (HookSnapshotRepo counter) *** FAILED ***
[info]   1 was not equal to 0 (LateFinisherSeamIsolationSpec.scala:75)
[info] - should invoke its own test's afterNodeWrite hook, not the next test's (HookSnapshotRepo afterNodeWrite) *** FAILED ***
[info]   false was not equal to true (LateFinisherSeamIsolationSpec.scala:89)
[info] - should complete its own test's foldDone, not the next test's (HookSnapshotRepo foldDone) *** FAILED ***
[info]   false was not equal to true (LateFinisherSeamIsolationSpec.scala:105)
[info] Total number of tests run: 5   Tests: succeeded 0, failed 5
```

## After the fix (capture at call start)

`Total number of tests run: 5  Tests: succeeded 5, failed 0` (all five test names pass).

## D4 — five single-capture mutations (each restored afterwards; each run executed 5 tests)

| Reverted capture | Result | Failing test(s) |
|---|---|---|
| `terminalWritten` (`written.trySuccess` -> `terminalWritten.trySuccess`) | succeeded 4, failed 1 | terminalWritten (GatedRunRepo), l.43 |
| `foldDone` (`fold.trySuccess` -> `foldDone.trySuccess`) | succeeded 4, failed 1 | foldDone, l.105 |
| `afterNodeWrite` (`hook(n)` -> `afterNodeWrite(n)`) | succeeded 4, failed 1 | afterNodeWrite, l.89 |
| node-write counter (`counter.incrementAndGet()` -> `nodeWrites.incrementAndGet()`) | succeeded 3, failed 2 | counter (1 was not equal to 0, l.75) and foldDone (l.105; the OLD counter never reaches 2) |
| `afterEngine` (`hook()` -> `afterEngine()`) | succeeded 4, failed 1 | afterEngine (HookBackend), l.64 |

## D5 — LateFinisherRunSpec + LateFinisherDeleteAfterWonSpec + LateFinisherSeamIsolationSpec, 5 repeats

Each of runs 1-5: `Total number of tests run: 21`, `Suites: completed 3, aborted 0`, `Tests: succeeded 21, failed 0`, exit 0.
(21 = 16 existing + 5 new; this measures stability, not proof — the proof is the red-first + mutation tables above.)

## Gates

`npm run check:scala-quality`: clean (249 pre-existing soft warnings; one inline-FQN violation in the new spec was fixed first). `npm run check:test-temp-dir-hygiene`: clean.
