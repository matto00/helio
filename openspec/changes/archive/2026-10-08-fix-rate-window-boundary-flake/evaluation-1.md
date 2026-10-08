## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: e214a781ce12f5ff4e7b4189e71516eb1b3505c5 (base 60fdb87ded6dd8d571767199b8d3fa05f6b093c7, resolved live via resolve-review-base.sh).
Changed non-openspec files: `MISTAKES.md`, `backend/.../PipelineRunService.scala`, `backend/.../DatasetWriteAutoRunEndToEndSpec.scala`.

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (measured red + control): the committed transcripts show the right shapes. Red runs 1.1-run1..3: the owner submit's guard check falls between `started`/`done`, both in minute M (08:53:16, 08:54:07, 08:55:07). `pre-first-tick` and `post-first-tick` both fall in M+1 (08:54:00.24-.34, and so on), and every red run fails `2 was not equal to 1`. Control runs 1.2-run1..3: submit and first tick are in the same minute (08:56:10 -> 08:56:12, 08:56:24 -> 08:56:26, 08:57:10 -> 08:57:12), runCount=1, green. The bracketing instants are wall-clock reads. They are not mtimes or file order.
- AC2: the assertion `runCount(pid) shouldBe 1`, limit 1 / window 60, and the 5s poll are unchanged (diff lines 203-214 of the spec). Nothing was widened and nothing retries.
- AC3: fixed + boundary is green (3.2-fixed-boundary-run1..3, all straddling M -> M+1 with runCount=1). Mutation A (SystemClock) + boundary is red (3.2-mutA-run1..2). I reproduced both myself (see Phase 2).
- AC4: design D4 records that epoch-aligned windows are intended (HEL-505 Decision 2). The spec delta adds the "Windows are fixed and aligned to the epoch" scenario and keeps all three existing scenarios verbatim. No requirement is weakened. The production change is only the defaulted seam, and its reason is stated.
- AC5: the MISTAKES.md entry sits right after the existing sbt 2 entry. It separates "Reported, not reproduced here" (HEL-1285 skeptic) from "Verified safe invocation", and it says how to check the project path.
- Tasks 1.1-4.2 are all [x] and match the diff. The executor note on 2.2 (`cleanupOldWindows` not reached because the scheduler's `pipelineRunGuardRepo` is null in this spec) is correct: PipelineSchedulerService.tick runs cleanup only when `pipelineRunGuardRepo != null`.
- Scope: HEL-1196's test conversions were not absorbed. Only the seam was added.
- CONSTRAINTS C1-C4 are honored. C1: no widening. C2: the red was measured before the fix. C3: every transcript shows this worktree's `loading project definition` / `set current project` paths. C4: no probe or mutation code is in the committed diff (I grepped the diff for PROBE/sleep; the committed test has no probe).
- files-modified.md matches the diff (3 files + the change dir).

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates I ran myself in WORKTREE_PATH:
- `nice -n 19 sbt -batch -Dsbt.server.autostart=false testFull` from `backend/`: exit 0, project path is this worktree, `Tests: succeeded 6117, failed 0, canceled 4`, 440 suites, 0 aborted.
- `npm run check:scala-quality`, `check:openspec`, `check:spec-structure`, `format:check`, `check:no-credential-leak`, `check:repo-integrity`: all exit 0.
- No `frontend/**` changes, so the frontend gates do not apply.

Independent mutation checks. I ran these in a throwaway `git worktree add --detach` at e214a781c under the scratchpad, ran them in order, and removed the worktree afterward. `git worktree list` confirms it is gone. I used an env-gated probe that sleeps to the next epoch-minute + 200ms after the owner submit:
- Fixed code + boundary: `owner-submit-done=09:33:23.11`, `pre-trigger=09:34:00.20`, `post-poll runCount=1`, green.
- Mutation A (`newRunService(tightGuard)`, unpinned) + boundary: `09:34:21.14 -> 09:35:00.20`, `runCount=2`, `2 was not equal to 1`, red.
- A closer attribution mutation than the executor's Mutation B, with the pin kept and no probe. In `executeRun` I changed the rate check to key AutoRun submits on the pipeline root source's owner (`roots.headOption.map(_._2.ownerId)`, which is the writer in this case) instead of `user.id`. This is a real principal swap with a valid foreign key. Result: `runCount=2`, `2 was not equal to 1`, red.

This settles the question raised about Mutation B. The writer's identity never reaches the scheduler: the debounce row (V110) holds only `pipeline_id`, and `fireAutoRun` builds the principal from `pipeline.ownerId`. So "attribute to the writer" cannot be realised literally. The executor's stand-in ("skip the rate check for AutoRun") is behaviourally equivalent, and a literal principal-swap mutation also goes red with the pinned clock. Attribution mutation-sensitivity is preserved. Structurally this is expected: the pin does not depend on the user, and the writer's bucket in the pinned window is never touched.

Code quality:
- `PipelineRunService.scala:108-113`: a trailing defaulted `guardClock: Clock = SystemClock`, documented as driving only the rate bucket, with one call-site change at `:1048`. All existing callers compile unchanged (testFull is green). No FQNs, and the import is grouped.
- The spec reuses the existing `FakeClock` (DRY). The comment at `:206-210` explains the pin.
- No dead code, no TODOs, no over-engineering.

Evidence files: there are 14 transcripts, about 355 KB in total, mostly logback/Flyway noise. No secrets: the only connection strings are ephemeral embedded-Postgres `jdbc:postgresql://localhost:<port>/postgres?user=postgres`, with no password.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` changes. The spec delta is under `openspec/changes/`.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- The probe and mutation transcripts in `evidence/` do not record the code change that produced them. For example, `3.2-mutB-attribution.txt` contains no diff of the mutation, so a reader cannot tell from the file what was mutated. Next time, prepend the `git diff` of the temporary change to each transcript. I verified independently this cycle, so this is not blocking.
- The MISTAKES.md "Verified safe invocation" paragraph proves that the invocation ran against the current directory's build. It was not tested against a live foreign sbt server, so "prevents attaching" is still inferred. Consider stating that explicitly.
- The transcripts could be trimmed to the probe and summary lines. Keeping the sbt project-path header plus ScalaTest output would cut about 29 KB of logback/Flyway noise per file.
