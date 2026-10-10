## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `feaa10b6e818d59bf3f7acc05ab09a6672b3da20`
Live-resolved review base (`resolve-review-base.sh ... main origin`): `6902b57f12a18042daf9b8e4984cc55b2011fc84` (it equals `git merge-base`).
Diff: 252 files. 224 are under `backend/src/test/scala` (221 migrated plus 3 new). The other 28 are in the change dir. Nothing else changed.

### Phase 1: Spec Review — PASS
- AC1 (one shared helper): PASS. `VerifiedEmbeddedPostgres.start(builder: => Builder)` gives each attempt its own data dir and compares `SHOW data_directory` against both the `toRealPath` and the `toAbsolutePath.normalize` form. On a mismatch or a failed check it retries, at most 5 times, with `setPort(0)` from attempt 2 on. When attempts run out it throws an `IllegalStateException` that carries the per-attempt log. Exceptions from zonky's own `start()` propagate unchanged. This matches D1–D4.
- AC2 (mechanical migration): PASS. I re-ran the verifier myself against the live base: `files with builder at base: 221`, `changed backend files: 224 (expected 224 = 221 + 3 new)`, `base occurrences: 226 wrapped: 226 unwrapped: 0 inserted imports: 221`, `RESULT: PASS`. I also checked the `-U0` diff independently of the verifier:
  - every removed line contains `EmbeddedPostgres.builder()`, except the one `.start()` line in SqlConnectorTlsSpec;
  - every added line contains `VerifiedEmbeddedPostgres`, except the matching lone `)`;
  - all 221 inserted imports sit directly after `import io.zonky.test.db.postgres.embedded.EmbeddedPostgres` at top level.
- AC2 (multi-line SqlConnectorTlsSpec): PASS. `SqlConnectorTlsSpec.scala:38-42` matches D5's exact rule. The base `          .start()` became `          )` with its leading whitespace kept, and the chain lines are byte-identical.
- AC3 (guard red-first): PASS. `/tmp/hel1445-logs/3.1-red.log` lists 221 offending files under `*** 2 TESTS FAILED ***`. On my own run the guard is 7/7 green.
- AC4 (deterministic repro): PASS. Step 2 asserts that the old direct path reports A's `data_directory`. Step 3 asserts the helper ends on a different port, on its own dir, without A's marker, with A intact. My run: 5/5 green. The executor's mutation (`true ||` on the comparison) turns steps 3 and 4 red (`2.2-mut-red.log`).
- AC5 (RLS unchanged): PASS. The diff touches no role, GRANT, BYPASSRLS, SET ROLE or IF NOT EXISTS line: the only `ROLE` hit in the diff is a filename header. The BYPASSRLS mutation turns `assertAppPoolEnforcesRls` red in both OutputHistoryRoutesSpec and OutputHistoryPayloadRoutesSpec (4 failed). After the revert they are green, and byte-equality on `OutputHistoryApiHarness` confirms the revert.
- AC6 (parity): PASS. Base 472 suites / 6529 tests and branch 474 / 6541, with 0 failure strings in either log and 0 failures+errors in the XML. The per-suite TSV diff contains only the 2 new specs (7 + 5 = 12 tests). I confirmed that the base snapshot `/tmp/hel1445-base` is byte-identical to `git archive 6902b57f1` for `backend/src` and `build.sbt`. No backend `.scala` file is newer than the loop logs, so the runs tested the committed tree. I found no reason to doubt the parity evidence, so I did not run a second testFull.
- AC7 (loop): PASS. There are 47 iteration logs, with 0 matches for `TESTS FAILED|*** FAILED|RUN ABORTED|*** ABORTED` across all of them. Each log has exactly one `Suites: completed 15, aborted 0` and `Tests: succeeded 108, failed 0, canceled 1`. The canceled test is the pre-existing latency test, `CANCELED` in every iteration. Overlap counts: 12 iterations with 0, 26 with 1 and 9 with 2, so 35 qualify (at least 30 required). The 12 excluded iterations were excluded honestly: they are disclosed, their only difference is zero cross-group overlap, and every one of them also passed. Same-group overlap is 0 in every iteration. `xmltable.py` implements D8's end-based window, the >1 s threshold, and Java `hashCode` floorMod 4.
- AC8 (HEL-1470 fixed-by in the PR body): this is a delivery-phase item with no PR yet, so it can't be evaluated here. The orchestrator must include it.
- Tasks 1.1–5.4 are all ticked and match the implementation. There is no scope creep, and the planning artifacts reflect the shipped behavior.
- CONSTRAINTS C1–C5: all honored.
  - C1: proven by the verifier.
  - C2: proven by the diff grep.
  - C3: every verdict here is judged by log.
  - C4: run logs show `nice -n 19`, `-J-Xmx3g` and `-Dsbt.server.autostart=false`.
  - C5: the env is set in `run-loop.sh` and `run-parity.sh`, and the logs show `Limit forked-test-group to 2`.
- Commit message: no `claude.ai` link and no `Claude-Session` trailer. It has only the `Co-Authored-By` line.

### Phase 2: Code Review — PASS
Gates, run fresh by me:
- `sbt -batch -Dsbt.server.autostart=false testOnly` on EmbeddedPostgresStartGuardSpec, VerifiedEmbeddedPostgresSpec, OutputHistoryPayloadsAvailableSpec and OutputHistoryRoutesSpec, with `nice -n 19` and `-J-Xmx3g`. Log: `Suites: completed 4, aborted 0` / `Tests: succeeded 47, failed 0`, 0 failure strings, and the project path names this worktree.
- `check:scala-quality` clean (soft warnings only), `check:test-temp-dir-hygiene` clean, `format:check` clean, `check:no-credential-leak` OK (0 violations), `check:openspec` clean, `check:spec-structure` passed.
- I skipped the full `testFull` re-run on purpose (see AC6). No frontend files changed.

Code:
- Helper non-return paths:
  - When `start()` throws, the attempt dir is deleted and the exception is rethrown. There is no instance to close.
  - When the comparison mismatches, or the observer throws something `NonFatal`, the result is `Left`. The helper then calls `pg.close()` (any close failure is logged) and `deleteQuietly(dir)`.
  - `showDataDirectory` closes its connection in `finally`, which also closes the statement and result set.
  - So every path that does not return the instance closes it, apart from the fatal-throwable gap noted below.
- Guard: it implements every D7 rule (bare and spaced builder, renamed or wildcard zonky import, static start with an identifier lookbehind, `.start()` inside the builder argument of `start`/`startWith`, and the per-line exemption marker). The patterns are built by concatenation, so the guard does not flag itself. It has positive, negative and non-vacuity cases.
- Type safety, DRY, naming and error handling are all fine. The new files are well under the size budgets. There is no dead code.

### Phase 3: UI Review — N/A
No trigger matched. No file under `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` changed. The spec delta lives under `openspec/changes/`.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `VerifiedEmbeddedPostgres.scala:63-71` catches only `NonFatal`. If `observeDataDirectory` raises a fatal throwable (`InterruptedException`, a `VirtualMachineError`), the attempt is not closed before propagating. D2 calls for a try/finally-style structure. The practical impact is nil, because zonky's JVM shutdown hook closes it. Wrapping the check in `try ... finally { if (!verified) discard }` would make it literal.
- `VerifiedEmbeddedPostgres.scala:60-61`: when zonky's `start()` throws (e.g. "Gave up waiting"), the helper deletes the data dir that a still-starting postmaster may be using. Before this change zonky left that dir in place. This is harmless in practice, but it is a slight behavior change on a path D4 called "unchanged".
- D6 step 5's second mutation proof is not in the transcript. That proof would let the observer's exception propagate. By inspection the tests have teeth: `the[IllegalStateException] thrownBy` cannot be satisfied by a propagated `SQLException`.
- `EmbeddedPostgresStartGuardSpec.scala:71-73` exempts files by bare filename, not by path. A second file named `VerifiedEmbeddedPostgres.scala` anywhere would be fully exempt. Matching on the full `com/helio/testkit/...` path would close that gap.
- CONTRIBUTING.md documents the analogous `RouteTestBaseGuardSpec` convention (line 254). A one-line note that embedded Postgres must be started through `VerifiedEmbeddedPostgres.start` would help future spec authors before the guard fails on them.
