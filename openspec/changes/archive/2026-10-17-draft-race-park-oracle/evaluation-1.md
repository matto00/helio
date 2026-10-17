## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 91fd7b16a6576c93e09f9b7e4fb8e57a351a9296 (base 4429d46fd66efd2f40ad18adea6bc9e1bdfd07ec, resolved live via resolve-review-base.sh).
Code diff: `backend/src/test/scala/com/helio/testsupport/DraftRaceFixture.scala` (+109/-30) and `docs/live-draft-preview.md` (+2). No production source, migration, schema or frontend file is touched.

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (root cause with pg_locks traces at the parked point and the writer's commit): `evidence/root-cause.md` and `evidence/probe-parked-locks.log.txt`. Section B (old fixture, forced delay): when the save is "parked", it is `active`, waiting on `hel1498_lock_panels`, and holds no `alert_rules` lock. The writer is then `idle q=COMMIT`. Section A (unperturbed, real park): the save is `idle in transaction` and holds `alert_rules`, and the writer is blocked by the save's pid. So the cause is (b), and (a) is refuted with database evidence.
- AC2 (50/50 under load, every lock-removal mutation red): `evidence/fifty-under-load.log.txt` shows 50/50 runs and 850/850 test executions. `evidence/mutations/TABLE.md` covers M4–M7 and SK1/SK3/SK5. I re-ran M4 myself (see Phase 2).
- AC3 (siblings): `evidence/sibling-audit.md`. All fixes are in the shared fixture. `siblings-under-load.log.txt` shows 15/15 runs of DraftSaveRaceSpec and DraftSaveSetRaceSpec (151 tests each). The commit-order weakness was found in a sibling run and fixed in the fixture.
- AC4 (protocol changed?): no, so it does not apply. §8.3.1 got a harness-correction note anyway.
- AC5 (release exposure): I checked it again myself. `v0.9.8^{commit}` = 29cb0a60f. `merge-base --is-ancestor 544bd79ea v0.9.8` returns exit 1 (not an ancestor). v0.9.8 has 0 V137 paths. `git tag --contains 544bd79ea` is empty.
- Tasks 1.1–3.6 are all checked and match the diff. Task 1.1's isolated DB was not needed because the specs boot embedded Postgres. That outcome is recorded honestly in tasks.md.
- CONSTRAINTS: C1 holds (cause probed before the fix; production lock code unchanged). C2 holds (no `helio` DB contact, embedded PG only, no leftover processes from this review; the live `postgres -D /var/lib/postgres/data` and a 3 h-old `sbt run` predate it). C3 holds (the executor's logs record the flock, nice and load profile; my runs used the same).

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates (my own fresh runs, under `nice -n 19 flock -w 3600 …/sbtfull.lock`, load gate first, `HEL924_TEST_GROUP_CONCURRENCY=2 HELIO_TEST_JVM_XMX=4g`):
- `cd backend && sbt testFull` in WORKTREE_PATH: exit 0. 9191 tests run, 642 suites, 0 failed, 0 aborted, 4 canceled (pre-existing assumption cancels). hel1468-guard reports failed=0. The log has 0 lines with `HARNESS:`. Log: scratchpad `hel1654-eval/testfull.log`.
- `npm run check:scala-quality`: clean. It gives a soft warning that DraftRaceFixture.scala is 407 lines, against a soft budget of 250.
- `check-openspec-hygiene`: clean. `prettier --check docs/live-draft-preview.md`: clean.

Independent M4 re-run (focus 1). I created a throwaway worktree detached at 91fd7b16a under the scratchpad, applied the M4 mutation there (fingerprint read moved above `lockDefinition`, the same diff as `evidence/mutations/M4.diff`), and ran `testOnly DraftSaveRaceSpec DraftSaveDeadlockSpec DraftSaveSetRaceSpec`. Result: 168 tests, **19 failed**, every one "writer-first: be excluded from the save's window". All 19 traces say `commit order: save waited on the writer`. This matches the executor's 19 and HEL-1629's original 19. I removed the worktree afterwards; `git worktree list` has no scratchpad entry. Log: scratchpad `hel1654-eval/m4.log`.

Focus-point findings:
1. **Commit-order change and the lostUpdate oracle.** The change does not weaken the oracle. `writerCommittedFirst` is now set as follows:
   - `saveWaitedOnWriter` gives true. The save was observed in `pg_blocking_pids` waiting, directly or through a chain, on the writer.
   - `writerWaitedOnSave` gives false. This is only observed while the save is confirmed `idle in transaction` at its park.
   - Otherwise it falls back to Future completion order, which is the old behaviour.

   Each observed wait proves which transaction ended first, because every lock involved is transaction-scoped. I grepped `backend/src/main` for session-level `pg_advisory_lock`/`pg_advisory_unlock` and found no hits. The only session-level advisory lock is the harness GATE, which the coordinator holds, not either participant. So a blocked transaction cannot finish before the one it waits on.

   The "writer committed first" class that M4 produces (the save reads a stale fingerprint, then queues behind the writer) is now decided by the observed wait rather than by Future timing, which is stronger than before. The re-run confirms this: 19/19 are decided on that basis.

   The one ordering the new code can report as "save first" (the writer observed waiting on a parked save) is one where the writer cannot have committed first. A writer that commits while the save is parked still goes through `committedWhileParked` and is flagged independently. Multi-transaction writers, where one transaction commits and a later one waits, produce the same verdict as the old Future-order oracle, so this is not a regression.
2. **Vacuous passes.** None. The protected assertions still require `blockedObserved shouldBe true`: `DraftSaveRaceSpec.scala:211`, `DraftSaveSetRaceSpec.scala:36` and `DraftSaveDeadlockSpec.scala:34`, plus `blocked shouldBe true` in the duel at :176. No spec file changed.

   `blockedObserved` is set only from an observed `waitsOn`/`anyWaitsOn`, and the old "latest backend only" lookup is now widened to every non-idle backend with the application name. In SaveFirst, a save that never parks no longer starts the writer: the test fails with `harnessFail`. A save that finishes early still starts the writer but cannot reach `blockedObserved=true`, so a protected case fails.
3. **Hang-guard expiry fails loudly.** Every `waitFor` that decides a verdict now uses `HangGuardMs = 60000`. On expiry it calls `harnessFail`, which is ScalaTest `fail("HARNESS: … (no verdict is drawn)")` plus the trace. That happens inside `try { } finally`, which only releases resources, with no catch, so the throw reaches the test. This covers:
   - `race`: WriterFirst gate, settle and writer waits; SaveFirst park and writer waits.
   - `race3`: reader stall, grower, park and reader wait.
   - `duel`: first reached the gate, second waited.

   `confirmParked` also fails as a harness fault if the save is not `idle in transaction` within the guard. The old 5000 ms windows that could decide a verdict are gone.
4. **Park signal.** `park` = `DBIO.successful(()).flatMap { _ => parked.trySuccess(()); DBIO.from(release.future) }`. The signal now fires when Slick executes the hook, not when the action is built. That is correct no matter whether production composes `afterLock` eagerly or lazily. Production `PipelineDraftWrites` is untouched, as design D2 requires.

Other checklist items:
- Canonical quality: no inline FQNs (the check passes) and the imports are unchanged.
- DRY: `anyWaitsOn`, `harnessFail` and `confirmParked` remove the duplicated window logic.
- Readability: comments explain why each choice was made.
- Error handling, dead code, over-engineering: no issues. The removed `activeBackend` has no remaining callers.
- Behavior-preservation: production behaviour is unchanged; test-only diff.

### Phase 3: UI Review — N/A
No file matches `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**`. Dev servers were not started.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- `DraftRaceFixture.scala` is now 407 lines (it was 357). CONTRIBUTING.md:24 says that once a file passes about 400 lines, the PR description should propose a split. A natural seam is the Postgres-observation helpers (`activeBackends`/`anyWaitsOn`/`waitsOn`/`blockers`/`gateWaiters`/`heldLocks`/`confirmParked`), which could move into their own `RaceLockObserver` trait. Mention it in the PR body.
- Pre-existing, not introduced here: the final `Try(Await.result(sf/wf, 30.seconds))` still turns a save or writer that never finishes into `Left(InternalError)`/`Failure` rather than a `HARNESS:` failure. A protected case still needs `blockedObserved=true`, so it cannot pass vacuously. A spinoff could still route that timeout through `harnessFail` for a clearer message.
- `evidence/mutations/TABLE.md` and `root-cause.md` cite logs under `.concertino/runs/HEL-1654/evidence/`, which is outside git. They survive `cleanup.sh --phase4` but not a fresh clone. The committed filtered logs carry the load-bearing counts, so this is acceptable as is.
