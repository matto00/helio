## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 2fb8deb5a0cefb9855262991db39fba9d3ebd1ec (the change dir is untracked; artifacts read from disk).

### What I verified (with evidence)
- cwd guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/relabel-gate-tests-tidy-refs/HEL-1429`.
- Ticket text read live from Linear (HEL-1429 description). Item 3 says: "`PipelineRunService.scala` is 652 lines (it was already over 400 before HEL-1384), and `PipelineSchedulerService.scala` is 314. Split along concern lines ... Check overlap with HEL-1393 first and combine if they collide." Linear has no AC section; ticket.md's AC (including "Item 3: dropped") was written during planning.
- Items 5-9 corroborated against `/home/matt/Development/helio/.concertino/runs/HEL-1393/evidence/openspec/changes/move-pipeline-preview-out/skeptic-final-1.md` non-blocking notes. They match the relay.
- Line counts (`wc -l`): PipelineRunService.scala 386, PipelineSchedulerService.scala 314, PipelineRunPreview 298, PipelineRunExecutor 330, PipelineRunBackfill 172.
- CONTRIBUTING.md:24: "Soft budgets: **~250 lines per source file** ... If a file you're editing crosses ~400 lines, propose a split in the PR description rather than adding to it".
- Item 1 / D2: `git rev-parse 99d6fedd^` = 1bf11f55f8039bf7248fcdb61c28a52810a545db. FireTimeRunConfigGateSpec has not changed since 99d6fedd (`git log 99d6fedd..HEAD -- <spec>` is empty). HEL-1384's own evaluator ran this spec against a scratch base checkout. The log is at `/home/matt/Development/helio/.concertino/runs/HEL-1384/evidence/eval1-red-on-main-FireTimeRunConfigGateSpec.log`: it compiled, and the result was "succeeded 3, failed 7". Both undecodable-config tests failed (`*** FAILED ***` at log lines 416 and 453; evaluation-1.md:29/36 quotes `true was not equal to false`). 2.4a and the two negative controls passed. So D2's procedure is feasible, and it is expected to confirm the ticket's claim. Spec lines checked: header 39-42, banner 343-345, group heading 386.
- Item 2: PipelineSchedulerService.scala:251 says "this `recover`", inside `fire()` (234). `gatedSubmit` is at 266. Confirmed.
- Item 6 / D4: `findPrimaryDataSourceIdInternal` has its definition at PipelineRepository.scala:117. The other references are doc/comment only: PipelineRepository:129, :145, :178 and PipelineService:957, :986, :1340. I found no call site. D4's compile gate is the right confirmation.
- Item 5: the stale describe titles exist at PipelineRunServiceSpec:447, :547, :749 and :2167, and the comment is at :2144. Current owners: `executeRun`/`onRunSuccess` are private in PipelineRunExecutor (89/271). `onUnblockedRunSuccess` is in PipelineRunSucceededWrites:53. `evaluateNodeRowsForBackfill` is in PipelineRunBackfill:100. `previewStep` is in PipelineRunPreview:27, and a public delegator still exists at PipelineRunService.scala:262-264.
- Item 7 / D5: the archived forbidden-classification.md has no numeric per-file pin. The stale content is line 52, which attributes step-preview `authorizedForAi` to `PipelineRunService`. ExistenceNotLeakedRoutesSpec:529-530 pins `PipelineRunPreview.scala -> 1` and `PipelineRunService.scala -> 1`.
- Item 8 / D6: all six "Defaulted to `None`" hits exist at the cited lines (`grep -rn`).
- Item 9: PipelineRunService.scala:276-280 wording confirmed.

### Verdict: REFUTE

### Change Requests
1. **D1 misstates its basis for dropping the PipelineSchedulerService split (design.md D1, proposal.md Non-goals, ticket.md AC "Item 3").**
   - The PipelineRunService half of the drop is sound. That premise went stale (652 -> 386 after #888), and the ticket itself said "combine if they collide" with HEL-1393.
   - The PipelineSchedulerService half is not sound. Its premise did not change: the ticket author saw 314 lines and still asked for a concern-line split. The ticket invokes the 400 threshold only for PipelineRunService ("already over 400 before HEL-1384"), so "the threshold the ticket itself invoked" does not cover the scheduler.
   - CONTRIBUTING.md:24 does not support the drop either. Its soft budget is ~250, and 314 exceeds it. The ~400 figure only means "propose a split in the PR description when an edit crosses it"; it is not a floor below which a split is churn.
   - The file also has a clean concern seam: auto-run debounce processing (`processAutoRunDebounce`/`processAutoRunClaim`/`fireAutoRun`, :125-192) versus cron schedule firing (`processCandidate`..`nextFireTimeLogged`, :193-314).
   - Dropping an unchanged, explicit ticket item is a scope reduction. It is not "minor staleness", and it was self-approved.
   - Do one of the following:
     - (a) Keep the PipelineSchedulerService split in scope. Plan it along that seam, behaviour-preserving, in the HEL-1371 style, with its own tasks.
     - (b) Escalate and get a recorded ruling to drop it. Then restate D1 accurately: the PipelineRunService half is superseded by #888; the PipelineSchedulerService half is dropped by ruling X; CONTRIBUTING's 250 budget is acknowledged as exceeded.

   Either way, the ticket.md AC for Item 3 must match the chosen path.
2. **D3 rename rule is ambiguous and, for the :2144 comment, would falsify a quote.**
   - The :2144 comment quotes the literal title of a describe block that HEL-904 deleted, and that quote was accurate when written. Replacing the owner inside the quote produces a title that never existed. State that the quote stays verbatim, with an appended note (e.g. "`onUnblockedRunSuccess` now lives in PipelineRunSucceededWrites"), or that it is reworded so it is no longer a quote.
   - "Name the member's current owner" also needs a precise rule. Two cases are unclear:
     - `PipelineRunService.previewStep` still exists as a public delegator (PipelineRunService.scala:262-264). If the :2167 tests call `runService.previewStep`, that half of the title is not stale.
     - `executeRun`/`onRunSuccess` are `private` in PipelineRunExecutor, so tests reach them only through a public entry point.
   - Specify the convention, e.g. "<entry point the test calls> (<current owner of the exercised member>)". Require the executor to decide each title by reading the test body's call, not only by grepping for the `def`.

### Non-blocking notes
- D2: name the throwaway location explicitly as the session scratchpad (`/tmp/claude-1000/...`), as HEL-1384's evaluator did (see the log path above). That keeps it outside the worktree, the main checkout root and `~`. Cite the HEL-1384 red log as corroboration, but the AC still requires a fresh run. D2 is silent on a test that fails with an uncaught exception rather than an assertion. The prior log shows both undecodable tests fail on assertions, so this is unlikely to matter; if it does happen, classify it explicitly rather than defaulting to GUARD.
- D5: the archived note never stated a numeric pin ("-> 2"), so the appended note should not claim one was there. Say what is now stale: line 52's attribution of step-preview `authorizedForAi` to `PipelineRunService`. Then state the current pins from ExistenceNotLeakedRoutesSpec:529-530.
- D9: running testFull twice in full is heavy. That is fine under the stated caps, but record which SHA is "base" (2fb8deb5).
- D8 and D6 look sound as written.
