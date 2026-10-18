## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 91fd7b16a6576c93e09f9b7e4fb8e57a351a9296. The base is 4429d46fd66efd2f40ad18adea6bc9e1bdfd07ec, resolved live with `resolve-review-base.sh` (exit 0).
The code diff is `backend/src/test/scala/com/helio/testsupport/DraftRaceFixture.scala` (+109/-30) and `docs/live-draft-preview.md` (+2). There is no production code, migration or frontend change. No UI changed, so no dev servers were started.

### What I verified (with evidence)

**Root cause (b), harness race. Confirmed from code and from database traces.**

Code:
- `PipelineDraftWrites.scala:88-92`: `taken(site, lock) = locks.choose(...).andThen(afterLock(site))`. The `val panels/advisory/rules/outs` bindings therefore call `afterLock(site)` eagerly, when `lockDefinition` is invoked.
- `DraftSaveTransaction.scala:78`: `lockDefinition` is invoked right after `hooks.at(Begin)`, so this happens before any lock statement runs.
- The old `RaceSaveHooks.at` completed `parked` inside the call, before it returned the DBIO. So for any `parkAfter = Some(<non-pipeline site>)`, the save was declared parked while it held no lock.
- `SavePipeline` is the exception: its `afterLock` sits inside the `for` (lines 101 and 110), so it is lazy.

Database traces (`evidence/probe-parked-locks.log.txt`):
- **Section B**, old fixture with forced delay. At "parked-declared" the save is `state=active wait=Lock/transactionid` on `hel1498_lock_panels` and holds no `alert_rules`/`outputs`/`pipelines` lock. The writer then shows `state=idle q=COMMIT`. This matches the CI signature.
- **Section A**, unperturbed. When the save really is parked it holds `alert_rules` (or `outputs`), and the writer is `wait=Lock/transactionid blocked_by={save}`. The protocol holds, so (a) is refuted.
- **Section C**, new fixture under the same forced delay: parked is declared only once those locks are granted, and the writer is blocked.

Statistical repro (`repro-under-load.log.txt`): 6 of 15 old-fixture runs were red. The traces self-authenticate as the old fixture. The protected `parkAfter=SaveRules` case prints "PARKED past its compare", which the new fixture would print as "after the save.rules lock". Every red trace shows the writer completing and committing, not timing out a window. That is consistent only with a premature park, given section A.

**The fix is a faithful execution-time signal.** `park = DBIO.successful(()).flatMap { _ => parked.trySuccess(()); DBIO.from(release.future) }`. The signal runs at execution time, after every earlier statement in the transaction has returned.

**No control or protected case can pass vacuously.**
- Protected cases still require `blockedObserved shouldBe true` (`DraftSaveDeadlockSpec.scala:34`, `DraftSaveRaceSpec.scala:211`, `DraftSaveSetRaceSpec.scala:36`). No spec file changed.
- `blockedObserved` is set only from an observed `waitsOn`/`anyWaitsOn`, which uses transitive `pg_blocking_pids`.
- The SaveFirst writer wait now resolves only on "writer completed" or "writer observed waiting". A writer blocked behind a parked save cannot complete until release, so the condition is decisive, not timed.
- Hang-guard expiry is `fail("HARNESS: ...")` inside a `try/finally` with no catch.
- `confirmParked` requires `idle in transaction` before the writer starts.
- A save that never parks fails the test before the writer starts (SaveFirst).
- Control cases assert `deadlock shouldBe true`, which is unaffected.

**Second fix: commit order taken from the observed lock wait.**
- `lostUpdate` applies only to `WriterFirst` (fixture `:196-197`).
- `saveWaitedOnWriter` means the writer's transaction ended first. `writerWaitedOnSave` (observed only while the save is confirmed idle-in-transaction at its park) means the save ended first.
- The participants hold only transaction-scoped locks. The evaluator grepped for session advisory locks in `backend/src/main` and I did not repeat that grep. Only the coordinator's GATE uses a session-level advisory lock.
- Both inferences are sound. A writer that commits while the save is parked is still caught independently by `committedWhileParked`.
- The triggering failure exists in `.concertino/runs/HEL-1654/evidence/pre-commitorder-fix/sib-2.log` around line 1261: `blockedObserved=true`, "writer is WAITING on the parked save", yet `violation=true`. That is a false red from Future order.
- M4 (save waits on writer) is still 19 red after the change. It is now decided by the observed wait.

**Mutations (`evidence/mutations/`, full logs in `.concertino/runs/HEL-1654/evidence/mutations/`).**
- Every mutated run's failure traces contain the new fixture's lines ("is idle in transaction ... holding relation locks", "commit order: ..."). So they self-authenticate as runs on the corrected fixture.
- Every applied `*.diff` is non-empty. There are 0 `HARNESS` hits in any mutation log, so every red is a verdict red, not a harness fault.
- Counts: M4 19, M5 1, M6 1, M7 4, SK1 39, SK3 1, SK5 4 red, out of 168 each.
- **SK3 faithfulness.** HEL-1629's skeptic-final-1.md (`.concertino/runs/HEL-1629/.../skeptic-final-1.md:63`) defines SK3 as "moved step delete's lock (3) before (1)". The re-expression swaps the operands in the active `StepDeletePanelsFirst` branch to `lockPipelines` then `lockForDeletion`, which is exactly that. It is an order mutation rather than a lock removal, as in the original.
  - SK3's red is the expected protected case ("not deadlock: the delete locks the panels before the pipeline row"), with `40P01`.
  - The SK3 no-op first attempt (168 green) is correctly excluded and labelled.
- M1–M3 target specs that do not extend `DraftRaceFixture`, so this diff cannot change their outcome.

**50/50 under load: genuine, not cached no-ops.**
- Each of the 50 `fifty/*.log` files has the worktree project path, `Total number of tests run: 17` and a hel1468-guard summary of failed=0.
- In-log timestamps show 50 serial runs from 15:31:21 to 15:49:48. They come after the 15:23–15:31 sibling loop and after the pre-fix sib-2 failure at 15:17. The pre-commitorder-fix fifty set (14:58–15:16) has different checksums.
- Passing runs print no traces, so the logs alone do not prove which fixture version ran. I therefore ran my own.

**My own independent runs on HEAD 91fd7b16a.** I recorded `git rev-parse HEAD` and a clean tracked status in each log header. Profile: `nice -n 19 flock sbtfull.lock taskset -c 0,1 sbt -batch -Dsbt.server.autostart=false testOnly`, `HEL924_TEST_GROUP_CONCURRENCY=2`, `HELIO_TEST_JVM_XMX=4g`, load gate.
- `DraftSaveDeadlockSpec` ×20: 20/20 green, 17 tests each.
- `DraftSaveRaceSpec` + `DraftSaveSetRaceSpec` ×3: 3/3 green, 151 tests each.
- In all 23 runs the project path is this worktree's, the hel1468-guard reports failed=0, and there are 0 `HARNESS` lines.
- Logs: `/home/matt/Development/helio/.concertino/scratch/HEL-1654/skeptic-final/{dl-*,sib-*}.log`, summary in `summary.txt`.

**Siblings.** `sibling-audit.md` matches the code. All three specs reach the choreography only through `race`/`race3`/`duel`. The siblings park at `AfterCompare`, which is lazy (`DraftSaveTransaction.scala:91`), so the bug was latent there. The 5 s windows and the single-backend lookup were shared and are fixed in the fixture. The executor ran the siblings 15/15 and I ran them 3/3.

**Release exposure, re-run.**
- `v0.9.8^{commit}` = 29cb0a60f.
- `git merge-base --is-ancestor 544bd79ea v0.9.8` returns exit 1, so HEL-1629 is not in v0.9.8.
- `git tag --contains 544bd79ea` is empty, and v0.9.8 has 0 V137 paths.
- Production is untouched by this ticket.

**Acceptance criteria.**
- Root cause with pg_locks traces: met (sections A/B/C).
- 50/50 under CI-like load: met. The executor's runs are corroborated by my 20/20.
- Every lock-removal mutation still red: met (table above).
- Siblings checked: met.
- Release exposure stated: met.
- The protocol did not change, so the AC clause "re-run the race/RLS suites and update §8.3.1" does not apply. The full `testFull` was green per the evaluator (9191 tests), and §8.3.1 got a harness note anyway.

**Leftover processes.** None from this review. The only sbt process (`sbt run`, 3 h old) predates it.

### Verdict: CONFIRM

### Non-blocking notes
- The `commit order:` trace note says "no wait observed" in SaveFirst even when "writer is WAITING on the parked save" was noted, because `writerWaitedOnSave` is set only in WriterFirst. This does not change any verdict (`lostUpdate` is WriterFirst-only), but the trace text misleads. Set the flag in SaveFirst as well, or word the note as "WriterFirst basis".
- `DraftRaceFixture.scala` is now 407 lines, over CONTRIBUTING.md's ~400-line threshold. The PR body should propose the `RaceLockObserver` split the evaluator suggested.
- Every file in `.concertino/runs/HEL-1654/evidence/fifty/` has the same mtime (15:49:58, copied). I did not use mtimes. Ordering was established from in-log timestamps and checksums, and independently from my own HEAD runs.
- The final `Await.result(sf/wf, 30.seconds)` remains a non-HARNESS timeout. This is pre-existing, and protected cases still need `blockedObserved`.
