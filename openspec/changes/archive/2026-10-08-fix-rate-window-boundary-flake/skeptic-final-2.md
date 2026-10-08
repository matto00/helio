## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD: dd81ec1b50c2888051f6fe533ec334078f441242. Base 60fdb87ded6dd8d571767199b8d3fa05f6b093c7, resolved live with `resolve-review-base.sh` (rc=0).

### What I verified (with evidence)

**Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/fix-rate-window-flake/HEL-1374`.

**Code and test are byte-identical since the last CONFIRM.** `git diff --stat e214a781c dd81ec1b5` touches only `MISTAKES.md`, 12 lines added and 5 removed. The same diff scoped to `-- backend frontend` is empty. Every code and test finding in skeptic-final-1.md still applies to this HEAD. That report used its own BASE and HEAD runs and its own mutations: E1 red on the unmodified test, E2 green with the pin, E3 red under Mutation A, E4 red under the attribution mutation. I re-read the whole branch diff myself:
- `PipelineRunService.scala` adds a trailing `guardClock: Clock = SystemClock`. It is used only in the `incrementRateIfUnderLimit(..., guardClock.now())` call. Production behaviour is the same, because `SystemClock.now()` is `Instant.now()`, which is what the repository defaulted to before.
- The spec adds a `newRunService(guardConfig, guardClock = SystemClock)` parameter. The owner-attribution case pins a `FakeClock` at `truncatedTo(MINUTES)+30s`.
- C1 is unchanged: `runCount(pid) shouldBe 1`, limit 1 and window 60 are all as before. Nothing retries or was widened.
- C4 holds: the committed spec contains no probe or sleep.

**A fresh targeted run on this HEAD.** Command: `nice -n 19 sbt -batch -Dsbt.server.autostart=false "testOnly com.helio.services.pipelines.DatasetWriteAutoRunEndToEndSpec"`, run from the worktree's `backend/` (`pwd -P` confirmed the path). rc=0. Output:
```
[info] loading project definition from /home/matt/Development/helio/.claude/worktrees/task/fix-rate-window-flake/HEL-1374/backend/project
[info] set current project to helio-backend (in build file:/home/matt/Development/helio/.claude/worktrees/task/fix-rate-window-flake/HEL-1374/backend/)
[info] - should a dataset write by a NON-OWNING writer schedules an auto-run that, once fired, counts against the PIPELINE OWNER's rate limit -- NOT the writer's (...)
[info] Suites: completed 1, aborted 0
[info] Tests: succeeded 5, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
```
I did not re-run testFull, as the brief instructed.

**The corrected MISTAKES.md entry: I checked each factual claim against ground truth.**
- "`command -v sbt` is `~/.local/bin/sbt`, the sbt-extras launcher": verified. `command -v sbt` gives `/home/matt/.local/bin/sbt`, and its header reads "A more capable sbt runner ... github.com/paulp/sbt-extras".
- "sbt 2.0.9": verified. `backend/project/build.properties` has `sbt.version=2.0.9`, and the transcripts print `welcome to sbt 2.0.9`.
- "14 transcripts in the HEL-1374 evidence ... both project-path lines named the worktree": verified. There are exactly 14 `evidence/*.txt` files. A per-file grep found 1 match for `loading project definition from <worktree>/backend/project` and 1 match for `in build file:<worktree>/backend/` in every file.
- The verified and reported claims are now separated correctly. The attach is labelled "reported and unverified". The heading changed from "Verified safe invocation" to "Invocation used". The entry says explicitly that the flag's ability to prevent an attach is untested, and that the project-path check is the safeguard either way. The "seven runs" understatement is gone. This resolves all of round 1's MISTAKES notes. The entry is accurate, hedged correctly and actionable, so it is fit for a shared repo doc.

**AC trace** (code unchanged since round 1, so traces 1–4 carry over and I rechecked them above):
1. Measured red plus control: evidence 1.1 and 1.2, and the round-1 E1 reproduction on BASE sources. MET.
2. Deterministic control, with the assertion and attribution sensitivity unchanged: the pinned FakeClock is on the shared runService, and Mutation B and E4 both go red. MET.
3. Green across a boundary, and red when the pin is removed: 3.2-fixed and mutA, and round-1 E2 and E3. MET.
4. Decision recorded: design.md D4 and the spec delta's epoch-aligned scenario. Production changes only through the stated seam. MET.
5. The MISTAKES.md sbt hazard and its invocation: verified above. MET.

**UI:** there are no `frontend/**` changes, so I skipped the design review.

### Verdict: CONFIRM

### Non-blocking notes
- The evidence transcripts start at sbt's `welcome` line and do not record the command line. So "Invocation used" for all 14 runs rests on the executor's account. My own run on this HEAD used that exact invocation and behaved as described. The doc does not overclaim beyond this.
