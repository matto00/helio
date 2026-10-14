## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 87d67400c9a34e17f93361504020d7751b1f8808. Diff base (resolved live): f230104627d640e4fea53c60073dab025a90c018.
Changed code: `backend/src/test/scala/com/helio/testkit/VerifiedEmbeddedPostgres.scala`, `VerifiedEmbeddedPostgresSpec.scala`
(test infrastructure only), plus openspec change artifacts.

### Phase 1: Spec Review — PASS
- AC1: `cleanUpFailedStart` (VerifiedEmbeddedPostgres.scala:116-139) checks `<dir>/epg-lock`, polls for `postmaster.opts`
  within `postLaunchWait`, and `stopByDirectory` (:145-171) runs `<bin>/pg_ctl -D <dir> stop -m immediate -w -t 30` and
  then `pg_ctl -D <dir> status`; exit 3 is treated as confirmed before `deleteQuietly`. The original throwable is rethrown
  at :76 (`throw t`) and only receives a suppressed reason. Met.
- AC2: every `pg_ctl` invocation is built as `Seq(pgCtl, "-D", dir) ++ args` with `dir` being the attempt's own directory.
  No port, name or PID search anywhere. The only `destroyForcibly` (:159) acts on the helper's own `pg_ctl` child `Process`
  handle, which design D2 allows. Met.
- AC3: the deterministic `afterLibraryStart` seam (D4) is used. **The red result was reproduced independently** (see Phase 2).
- AC4: `proof/red-green.txt` and `proof/zonky-citations.txt` are present. The citations match the design's re-verification.
- AC5: the existing scenarios still pass (fresh run below).
- Tasks 1.1-3.6 are all checked and match the code. `grep epg-lock backend/` matches only the correct name (task 3.6).
- The spec delta matches the implemented behavior. That includes the split of "library's own start fails" into
  pre-launch, post-launch and unconfirmed cases.
- CONSTRAINTS C1-C5 hold in the diff:
  - C1: no `kill`, `pkill`, `pgrep` or `killall`, and the tests only observe (`ProcessHandle.of(pid).isAlive`, a read-only
    `pg_ctl -D <own dir> status`, and `pg.close()` on the test's own captured instance).
  - C2: the hook is deterministic.
  - C3: the guard and its marker are untouched, and EmbeddedPostgresStartGuardSpec and EmbeddedPostgresGuardLexerSpec pass
    (`offenders=0`).
  - C5: the fake pid is `hel1586-not-a-pid`, and the D3 path never reaches `stopByDirectory` because `postmaster.opts` is
    absent.
- No scope creep.

### Phase 2: Code Review — FAIL
Gates (fresh runs in WORKTREE_PATH, `nice -n 19 sbt -J-Xmx3g`, foreground, one at a time). The run was scoped to the
targeted specs at the orchestrator's resource-cap instruction instead of a full `testFull`.
- VerifiedEmbeddedPostgresSpec + EmbeddedPostgresStartGuardSpec + EmbeddedPostgresGuardLexerSpec: 3 suites, 27 tests, 0
  failed. A later standalone VerifiedEmbeddedPostgresSpec run gave 11/11, including all 4 HEL-1586 tests.
- `com.helio.api.routes.telemetry.ProductEventRoutesSpec` (DB-backed): 8/8.
- `npm run check:scala-quality`: clean. The only new item is a soft size warning: VerifiedEmbeddedPostgresSpec.scala is
  317 lines against a 250 budget, which is informational.

Independent red-first check:
- I temporarily changed only the catch at VerifiedEmbeddedPostgres.scala:76 back to the pre-fix
  `deleteQuietly(dir); throw t`, ran `testOnly ...VerifiedEmbeddedPostgresSpec -- -z launched`, and then restored the file
  with `git checkout --`. `git status` is clean and HEAD is unchanged.
- Result: the post-launch test **FAILED** at VerifiedEmbeddedPostgresSpec.scala:241 (`portRefused(...) shouldBe true`, so
  the port was still listening).
  - `HEL1586-STATUS-BEFORE` showed `pg_ctl: server is running (PID: 2043612)` on `-D /tmp/hel1586-postlaunch13547981019948791085`.
  - The leaked postmaster, pid 2043612, was left alone and sent no signal. At 04:09:53 PDT, about 3 min later,
    `ps -p 2043612` was empty, so it had exited on its own.
  - I did not capture a live `ps` sample between the red run and that check, so I have no self-termination timing of my
    own. The executor's proof records about 107 s or less.
- After the restore, the green re-run gave 11/11 with pid 2054864 recorded, and `ps -p 2054864` was empty afterwards.
- The proof file cites the red failure at `:230`, while the current file has the assertion at `:241`. That is consistent
  with the proof being taken before later spec additions and is not load-bearing.

Issues:
1. **CONTRIBUTING.md "Imports & Qualifiers"** ("never inline a fully-qualified name when an import would do"):
   VerifiedEmbeddedPostgresSpec.scala:245 uses an inline `scala.util.control.NonFatal(_)`. `check:scala-quality` does not
   catch it because its prefix list does not cover `scala.util`. It is the only inline `scala.util.control.NonFatal` in
   `backend/src`, and an import works without any coupling cost.

Checked and acceptable:
- `java.lang.Boolean` and `java.lang.Long` at :201 and :219. Importing them would shadow Scala's `Boolean` and `Long`
  across the file, so an import does not "do" here.
- `destroyForcibly` on the helper's own `pg_ctl` child, as above.
- Error handling: a `NonFatal` thrown during cleanup becomes a suppressed exception, the interrupt flag is restored in
  `finally`, and the original throwable is never replaced.
- The tests cover all four branches: pre-launch (existing test), stop-confirmed, unconfirmed, and pid-absent through the
  foreign-port test.

### Phase 3: UI Review — N/A
No `frontend/**`, ApiRoutes, `schemas/**` or `openspec/specs/**` changes. This is test infrastructure only.

### Overall: FAIL

### Change Requests
1. In `backend/src/test/scala/com/helio/testkit/VerifiedEmbeddedPostgresSpec.scala`:
   - add `import scala.util.control.NonFatal` to the top-of-file imports;
   - change line 245's `case scala.util.control.NonFatal(_) => ()` to `case NonFatal(_) => ()`.

   This is required by the CONTRIBUTING.md Imports & Qualifiers rule. Re-run VerifiedEmbeddedPostgresSpec after the change.

### Non-blocking Suggestions
- `pgCtlStatus` (VerifiedEmbeddedPostgresSpec.scala:208-214) calls `new String(...)` without a charset and uses an
  unbounded `proc.waitFor()`. Consider `StandardCharsets.UTF_8` and a bounded wait, to match the helper's 60 s bound.
- VerifiedEmbeddedPostgresSpec.scala is now 317 lines (soft budget 250). Consider moving the HEL-1586 scenarios into their
  own spec file in a later change.
- The `proof/red-green.txt` red line reference `:230` is stale against the final file (`:241`). Optionally annotate it.
- Leaked-process record for this evaluation: one red re-run leaked pid 2043612 on the deleted
  `/tmp/hel1586-postlaunch13547981019948791085`. It received no signal and was gone by 04:09:53 PDT.
