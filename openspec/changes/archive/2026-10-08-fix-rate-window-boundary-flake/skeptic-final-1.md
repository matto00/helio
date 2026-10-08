## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: e214a781ce12f5ff4e7b4189e71516eb1b3505c5. Base 60fdb87ded6dd8d571767199b8d3fa05f6b093c7, resolved live with `resolve-review-base.sh`. The first two attempts failed with a DNS error (`Could not resolve host: github.com`). `getent hosts github.com` then resolved, and the third attempt returned rc=0. This was transient tooling trouble, not a defect in the work.

### What I verified (with evidence)

**Diff scope** (`git diff 60fdb87de...HEAD`): there are three non-openspec files. `PipelineRunService.scala` changes by +6/-1. `DatasetWriteAutoRunEndToEndSpec.scala` changes by +9/-3. `MISTAKES.md` gains 27 lines. Everything else is under the change dir. The committed spec has no probe, sleep or println; the only `Thread.sleep` calls are the pre-existing poll sleeps at :161 and :187. The working tree is clean apart from the untracked `evaluation-1.md`.

**Determinism: both guard checks read the pinned clock.** The owner's direct `runService.submit` and the scheduler's auto-run both go through the same `runService`. The case passes it to `newScheduler(runService)` at spec :216. Both submits reach the single guard call at `PipelineRunService.scala:1048`, which now passes `guardClock.now()`. `FakeClock` returns the fixed instant `truncatedTo(MINUTES)+30s` and nothing in the case calls `set`. The repository uses `now` only for `bucketStart` and `retryAfter` (`PipelineRunGuardRepository.scala:47-49`). `cleanupOldWindows` is not reached, because the spec's scheduler receives no `pipelineRunGuardRepo`. The spec runs on its own EmbeddedPostgres, so it shares no DB with other worktrees.

**C1 is unchanged.** These all stay as they were: `runCount(pid) shouldBe 1` (twice), `rateLimitPerWindow = 1`, `rateWindowSeconds = 60`, `pollUntil(scheduler, 5.seconds)` and debounce 0. Nothing retries and nothing was widened.

**No production behaviour change.** `guardClock: Clock = SystemClock` is a trailing defaulted parameter. `SystemClock.now()` is `Instant.now()`, so it is identical to the repository's previous default and is evaluated at the same call point. `guardClock` is used only at :1048 (grep shows that one use plus the declaration). The 32 existing `new PipelineRunService(` call sites compile unchanged.

**My own runs.** All were nice -n 19, `sbt -batch -Dsbt.server.autostart=false`, and serial. Every transcript shows `set current project ... (in build file:<expected dir>/backend/)`.

I ran the mutation runs in a `git archive` copy of HEAD's `backend/` under the session scratchpad. That kept the worktree untouched and avoided git worktree metadata. The probe is inserted after the owner submit and before `triggerAutoRun`. It sleeps until the next epoch minute + 200ms and logs the instants.

| Run | Code | Probe instants (owner submit -> pre-trigger) | Result |
|---|---|---|---|
| E1-run1 | BASE main + BASE (unmodified) spec | 09:42:18.89 -> 09:43:00.20 | runCount=2, `2 was not equal to 1`, RED |
| E1-run2 | same | 09:43:13.09 -> 09:44:00.20 | runCount=2, RED |
| E2-run1 | HEAD main + HEAD spec (pinned) | 09:44:19.25 -> 09:45:00.20 | runCount=1, GREEN |
| E2-run2 | same | 09:45:10.87 -> 09:46:00.20 | runCount=1, GREEN |
| E3-run1 | Mutation A: `newRunService(tightGuard)` (unpinned) | 09:46:15.29 -> 09:47:00.20 | runCount=2, RED |
| E3-run2 | same | 09:47:05.81 -> 09:48:00.20 | runCount=2, RED |
| E4 | pin kept, no probe; production mutated so an AutoRun rate check keys on the root source owner (the writer) | n/a | `2 was not equal to 1`, RED (attribution sensitivity preserved) |

These instants are wall-clock reads printed inside the run. They are not mtimes or file ordering. In the actual worktree, the target spec is 5/5 green. The guard-neighbour suites (`DatasetWriteAutoRunEndToEnd`, `PipelineRunGuardIntegration`, `PipelineRunGuardRepository`, `AutoRunGuardBurstProof`, `AutoRunGuardNoRetryStorm`, `ApiRoutesPipelineRunGuard`, `PipelineSchedulerService`, `PipelineRunService`) give: Suites completed 8, aborted 0; Tests succeeded 129, failed 0. Exit code was 0 both times. For the full suite I relied on the evaluator's `testFull` (6117 passed); I did not re-run it, because the changed surface is covered above.

**AC trace**
1. Measured red on the unmodified test, plus control: I reproduced it myself (E1, BASE sources). The committed control transcripts, 1.2-run1..3, show submit and first tick in the same minute and green. MET.
2. Deterministic control, with assertion and mutation sensitivity unchanged: shown by the pinned FakeClock on the shared runService, the C1 checks and E4. MET.
3. Fixed is green across a boundary, and red when the clock control is removed: E2 and E3. MET.
4. Recorded decision on epoch-aligned windows: design.md D4 says they are intended per HEL-505 Decision 2. The spec delta adds only the scenario "Windows are fixed and aligned to the epoch"; I diffed it against `openspec/specs/pipeline-run-guard/spec.md`, and the existing scenarios are verbatim. Production changes only through the stated testability seam. MET.
5. MISTAKES.md sbt entry: it is present and next to the existing sbt 2 entry. The verified/reported split is honest. "Reported, not reproduced here" labels the cross-worktree attach. The verified claim is limited to "ran in-process against the current directory's build", and every evidence transcript plus all of mine confirm that. The project-path check is a sound safeguard even if the flag does not block attach: an attached client would not print a fresh `loading project definition from <your worktree>`. MET, with notes below.

**UI:** no `frontend/**` changes, so I skipped the design review.

### Verdict: CONFIRM

### Non-blocking notes
- MISTAKES.md: the heading "Verified safe invocation" could be read as "verified to prevent cross-worktree attach". That was never tested against a live server from another checkout; the evaluator noted the same. The sentence "the thin client will happily talk to a server it finds" is likewise an unverified mechanism claim, though it sits under the "Reported" label. A follow-up could reword it to "verified to run in-process; not tested against a live foreign server". This machine's `sbt` is the sbt-extras launcher (`~/.local/bin/sbt`, which has no thin-client handling), which may explain why no attach was ever observed here.
- MISTAKES.md says "seven consecutive runs". The committed evidence actually holds 14 in-process transcripts naming this worktree, so the number is understated, not wrong.
- The evidence transcripts do not embed the diff of the temporary probe or mutation; the evaluator noted the same. My independent runs above cover this gap.
