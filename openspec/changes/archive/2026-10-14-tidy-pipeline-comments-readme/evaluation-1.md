## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `095ae7c6839f9b60b8b495f7db1fd22a64a2eac7` against base `e982754f55987b29f9e20b74c468701f2e464a7d`
(resolved live via `resolve-review-base.sh`). Spawn-cwd guard: READY.

### Phase 1: Spec Review — FAIL

- AC1 PASS. `PipelineSchedulerService.scala:215-220` now names "the submit branch's inner `.transform` in `gatedSubmit`
  (not its outer `transformWith`)". I checked each sentence against the code:
  - `executeRun`'s Failure branch (`PipelineRunExecutor.scala:249-251` -> `PipelineRunTerminalWrites.executeRunFailure`,
    which ends in `.map(_ => Left(executionFailureError(ex)))`) returns a successful Future that carries `Left`.
  - `submit`'s own pre-run lookups are `findByIdShared` (`PipelineRunService.scala:194`) and `findGrantRole` (`:199`).
    Both are inside the `submit(...)` Future, so the inner `.transform` (`PipelineSchedulerService.scala:238-243`) handles their failures.
  - The outer `transformWith` Failure case (`:260-262`) and the recordUnrunnable `.transform` (`:253-258`) both return a successful Future.
- AC2 PASS. `PipelineRunBackfill.scala:69-70` now names the `PipelineRunService.backfillOutputNode` pass-through.
  `grep -rn "backfillOutputNode(" backend/src/main/scala` finds exactly one production call, `OutputService.scala:77`,
  and the delegation at `PipelineRunService.scala:287`. The `PipelineRunService.scala:282` copy is literally accurate and was left as is.
- AC3 FAIL (one factual claim). The README names all 52 files. My re-run of its re-derive command gives 52 names, every
  one appears in backticks, and every backticked identifier is an existing file. The README carries the re-derive
  command and makes no completeness claim. **However**, one visibility claim is false:
  `README.md` lists `StepReferenceChecks` among "`StepPlacement`, `StepReferenceChecks`, `UpsertTargetAnalysis` and
  `InlineSourceCompensation` (all `private[pipelines]`)". The file has a public, unqualified top-level companion
  `object StepReferenceChecks` (`StepReferenceChecks.scala:80`). Its `private[services] def secondarySourceOwnershipF`
  (`:87`) is called from outside this directory, at `services/patchsets/PatchSetPipelineStepResolvers.scala:259`.
  The README's own rule ("Visibility notes use each file's top-level declaration ... a file with no qualifier is
  public") makes the "all `private[pipelines]`" claim wrong for this file. The supporting evidence
  (`evidence/claims.md` C4) cannot catch this. Its grep `'^private\[pipelines\] ...'` matches only qualified
  declarations, so an unqualified declaration in a file the README calls private can never show up. I ran the inverse
  probe over all 26 files the README marks `private[pipelines]`/`private[services]`, looking for any unqualified
  top-level `class|object|trait`. It returns exactly one hit: `StepReferenceChecks: 80:object StepReferenceChecks {`.
- AC4 PASS. All four `// ----` banners are gone, and no `^ *// ---` line remains. The file is now 443 lines.
  `should`/`in` name lines before and after are identical (diff empty), with 10 tests before and after. The red-first
  base `1bf11f55` and the GUARD meaning are still in the class doc (`FireTimeRunConfigGateSpec.scala:40-45`).
- AC5 PASS (evidence review). `e2e-flake-probe.md`, `pw-list.txt` and `pw-run.txt` record the command, the `--list`
  selection (exactly 1 test), workers=2, `--repeat-each=20`, and "20 passed (52.4s)". The probe is honestly recorded
  as not reproduced, not as fixed. I did not re-run the e2e probe. It is evidence of a negative, and no code depends on it.
- AC6 PASS. The diff outside `openspec/` is comments, the README and test-comment deletions only. There are no
  `frontend/`, `e2e/` or `schemas/` changes.
- Tasks: all checked. They match the work, apart from the AC3 defect above.
- CONSTRAINTS: `[]` (none to honor).

### Phase 2: Code Review — PASS (gates); the AC3 defect is recorded under Phase 1

Gates I ran myself in `WORKTREE_PATH` at HEAD `095ae7c68`:
- `sbt testFull`, run foreground as 4 shards (`HELIO_TEST_SHARD_INDEX=0..3 HELIO_TEST_SHARD_COUNT=4`,
  `HELIO_TEST_JVM_XMX=3g`, `SBT_OPTS=-J-Xmx3g`, `nice -n 19`). All exited 0:
  - shard 0: 2266 passed, 3 canceled
  - shard 1: 1791 passed (includes FireTimeRunConfigGateSpec)
  - shard 2: 1809 passed, 1 canceled
  - shard 3: 2217 passed
  - Total: 8083 tests, 0 failed. The executor reported 8079. The 4-test difference is not material, since no test was added or removed in this diff.
- `npm run check:scala-quality`: clean (soft warnings only, all pre-existing).
- `npm run check:openspec`: clean.
- `npx prettier --check` on the README and the change dir: clean.
- No frontend change, so the npm lint/test/build gates do not apply.

Stray-process check (requested): `ps -eo pid,comm` plus `readlink /proc/<pid>/cwd` for every `java` process found no
process running from this worktree, and nothing listens on 6883/9790. While I reviewed, the only java processes
belonged to HEL-1446's worktree. They were not touched, and they had exited by the end of the review. Nothing was killed.

CONTRIBUTING mechanical rules: no inline FQNs, no new code. The banner removal follows the ~1,000-line divider rule.

### Phase 3: UI Review — N/A

No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` change.

### Overall: FAIL

### Change Requests
1. `backend/src/main/scala/com/helio/services/pipelines/README.md` (Pipeline CRUD bullet): `StepReferenceChecks` is
   not `private[pipelines]`. Its file has a public `object StepReferenceChecks` (`StepReferenceChecks.scala:80`), whose
   `private[services] secondarySourceOwnershipF` is used from `services/patchsets/PatchSetPipelineStepResolvers.scala:259`.
   Take `StepReferenceChecks` out of the "(all `private[pipelines]`)" group. Describe it accurately, e.g. "the
   `private[pipelines]` class `StepReferenceChecks` plus a public companion object whose `private[services]`
   `secondarySourceOwnershipF` is shared with `patchsets`", or name it without a visibility note per D3.
2. `evidence/claims.md` C4: add the inverse probe that would have caught this, recorded with its output. For example,
   for each file the README marks `private[...]`, run
   `grep -nE '^(final |sealed |abstract )*(case )?(class|object|trait) ' <file>`, which must return nothing (or the
   README must note the exception). A grep that matches only qualified declarations cannot show that a file has no
   public declaration.

### Non-blocking Suggestions
- `evidence/spec-counts.md` says the testFull run executed 8079 tests. My sharded run executed 8083. This does not
  matter for this diff, but the figure is a claim about a run, not a fixed count.
