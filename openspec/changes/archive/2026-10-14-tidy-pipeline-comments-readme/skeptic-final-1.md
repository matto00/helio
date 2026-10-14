## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `b979cdb80ac42ca2b1be0e3b8d4ee48e4adc7d51` against the live review base `e982754f55987b29f9e20b74c468701f2e464a7d`
(`resolve-review-base.sh <WT> main origin`, exit 0). Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/stale-pipeline-comments-readme/HEL-1451`.

### What I verified (with evidence)

- **AC6, no behaviour change (content diff, not narrative).** `git diff BASE...HEAD -- '*.scala'`, filtered to `+`/`-` lines that are
  not `//` comments and not blank, gives no output (grep exit 1). Outside the change dir, the diff touches exactly 4 files: two
  main `.scala` files (comment-only), the README, and the spec (banner/blank lines only). Since every edited Scala line is a `//`
  line comment, none of them can affect compilation, so I did not re-run sbt. The evaluator's cycle-1 testFull at `095ae7c68` and the
  pasted `10 succeeded` for the spec in `evidence/spec-counts.md` are consistent with that.
- **AC1, gatedSubmit comment (PipelineSchedulerService.scala:213-220).** I read `gatedSubmit` (:232-262) myself:
  - The outer `Future.delegate(...).transformWith` is at :234.
  - The submit branch's inner `.transform` is at :238, and its `Failure` arm returns `Success(())`.
  - The recordUnrunnable branch's `.transform` is at :254 and also returns `Success(())`.
  - The outer `Failure` arm returns `Future.successful(())`.
  - `fire()` runs `updateAfterTickInternal` inside `.flatMap` after `gatedSubmit`.
  - `submit` (PipelineRunService.scala:187-209) does `findByIdShared` and then `findGrantRole` before `runPipeline`.
  - The executor's run-failure arm goes to `PipelineRunTerminalWrites.executeRunFailure`, which returns `Left(executionFailureError(ex))` at :124.

  Every sentence matches the code, and the comment now names the inner `.transform`, not the outer `transformWith`.
- **AC2, backfill comment (PipelineRunBackfill.scala:66-73).**
  - The only production call is `OutputService.scala:77`, which calls `pipelineRunService.backfillOutputNode(..., output.node.rootId)`.
    `ApiRoutes.scala:478` has a comment only.
  - `PipelineRunService.scala:273` delegates to the backfill, so the new pass-through wording is correct.
  - The duplicate in PipelineRunService.scala (:280-283) still says "the sole production caller (`OutputService`)". That is true for
    that method, so it was correctly left as it is.
- **AC3, README.**
  - The README's own re-derive command, run from the worktree root, gives 52 names.
  - Two loop checks found no missing file and no extra name: each of the 52 names appears in backticks in the README, and each
    capitalised backticked name in the README is one of the 52 files.
  - I listed the top-level declaration of every file (`grep` of `private[...]`/class/object/trait across all 52 files) and checked
    each visibility note against it. All match:
    - `PipelineCreatePreflight` is `private[services]` (:19).
    - `StepReferenceChecks` is a `private[pipelines]` class (:43) with a public object (:80), whose `private[services] secondarySourceOwnershipF` (:88) is used by `patchsets/PatchSetPipelineStepResolvers.scala:259`.
    - `PipelineAutoRunDebounceFirer`, `OrphanedRunReaper`, `PipelineRunDeletedRecovery`, `StepPlacement`, `UpsertTargetAnalysis`, `InlineSourceCompensation`, `OutputRowReads` and `OutputRootResolution` are `private[pipelines]`.
    - Every file listed without a qualifier is unqualified.
  - `PipelineCostInputGathering` is constructed in `PipelineService.scala:75` and handed to `PipelineAnalyzeReads` (:78).
  - There is no `db.run` in the directory (`grep -rln` lists only the README itself).
  - The README makes no completeness claim and carries the re-derive command, so it meets the HEL-1156 standard.
- **AC4, spec banners.**
  - The test and `should` name lines are byte-identical before and after (`diff` of the `" should {`/`" in {` lines between base and HEAD: empty, `NAMES-IDENTICAL`).
  - With comment lines stripped, the only remaining differences are 4 removed blank lines.
  - The load-bearing facts from the banners are already in the class doc at :36-45: the gap numbering, red-first with base `1bf11f55`, and the GUARD meaning ("green on main by design; each is shown failing against a deliberate mutation").
  - The file is 459 lines before and 443 after, well under the roughly 1,000-line threshold.
- **AC5, flake probe: I re-ran it myself, because the evidence alone could not rule out a wrong-server run.**
  - The probe file records the start-servers READY lines, `--list` selecting exactly one 430px test, the DEV_PORT-pinned command, and 20/20 passes.
  - `playwright.config.ts` has no `webServer`, so nothing could silently start a server. `baseURL` comes from `DEV_PORT` (:155), and the Vite proxy target from `BACKEND_PORT` (`frontend/vite.config.ts:18`).
  - I started this run's servers with `start-servers.sh` on 6883/9790 (READY) and `assert-phase.sh servers` (PASS).
  - I resolved each listening socket to its PID through `/proc`:
    - 6883 is served by a process with cwd `.../HEL-1451/frontend` whose environ has `BACKEND_PORT=9790`.
    - 9790 is served by a process with cwd `.../HEL-1451/backend`.
  - `DEV_PORT=6883 BACKEND_PORT=9790 nice -n 19 npx playwright test e2e/hel813-mobile-touch-target-floor.spec.ts -g "at 430px surface 7: Connectors page" --workers=2 --repeat-each=10`
    gave `10 passed (29.4s)`.
  - I stopped the servers with `stop-servers.sh` (`STOPPED ports=6883,9790`).
  - So the flake is independently not reproduced in 10 more runs against this worktree's own servers, the e2e code is unchanged by
    the branch, and correctly no fix was attempted.
- **claims.md failable forms.** C2/C3 ("no output = none missing/stale") and C4b/C4c (rc-reported inverse probes) can fail. The
  A/B items are show-the-code excerpts, not mechanical checks, but I re-derived every sentence they support independently (above),
  so nothing rests on them unverified.
- **UI:** none changed (no `frontend/**` diff), so step 4 does not apply.

### Verdict: CONFIRM

### Non-blocking notes
- PipelineSchedulerService.scala:217-218 gives "`findByIdShared` / `findGrantRole`" as examples of the failures the submit `.transform` guards
  against. On this call path, `owner` is built from `pipeline.ownerId`, so `submit` always takes the owner branch, and
  `findGrantRole` is effectively unreachable there (only an ownership change between the two reads could reach it). The sentence is
  not false ("e.g.", and these are submit's lookups), but `findByIdShared` alone, or a `runPipeline` pre-run lookup such as
  `resolveAllRootDataSourcesInternal`, would be the more precise example. claims.md A3 shows only that both are submit's lookups,
  not that both are reachable here.
- The headings in claims.md's C4b-C4d section are inside one code fence (the evaluator noted the same thing). This is cosmetic.
- The evaluation-2.md file is untracked in the worktree (not committed).
