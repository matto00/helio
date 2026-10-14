## Context

Tree at `e982754f5` (premise validation, `.concertino/runs/HEL-1451/evidence/premise-validation.md`):

- `PipelineSchedulerService.scala:213-218` comment: "the `Failure` case of `gatedSubmit`'s `transform` only guards
  tick() against an unexpected exception outside that path (e.g. a pre-submit DB lookup failure)". `gatedSubmit`
  (line 230) is an outer `Future.delegate(...).transformWith` whose empty-reasons branch calls
  `pipelineRunService.submit(...).transform { case Failure(ex) => log.error; Success(()) }`. "`gatedSubmit`'s
  `transform`" does not say which of the two it means; the ticket asks for the submit branch's `transform`.
- `PipelineRunBackfill.scala:69` says "the sole production caller (`OutputService`) passes the Output's own
  `node.rootId`". The only production call is `OutputService.scala:77`
  (`pipelineRunService.backfillOutputNode(...)`), which goes through `PipelineRunService.scala:274-286`'s
  pass-through. `PipelineRunService.scala:282` carries the same sentence; there it is literally accurate.
- `services/pipelines/README.md` "Holds:" names ~25 types; the directory has 52 `.scala` files.
- `FireTimeRunConfigGateSpec.scala` is 459 lines with four `// ----` banner blocks (lines 226, 280, 346, 391).
  CONTRIBUTING.md:53-56 justifies dividers only at roughly 1,000+ lines.
- hel813 surface 7 is `e2e/hel813-mobile-touch-target-floor.spec.ts:298`; one reported failure, passed on re-run.

## Goals / Non-Goals

**Goals:** AC1-AC6 in `ticket.md`. **Non-Goals:** behaviour change; touching HEL-1446's files; new e2e machinery.

## Decisions

D1 (item 1a). Reword so it names "the submit branch's `.transform`" (inside `gatedSubmit`'s outer `transformWith`)
explicitly. Every factual sentence of the rewritten comment is verified against the code, including the existing
claims (that `executeRun`'s Failure branch yields a successful Future carrying `Left`). Keep the example "a
pre-submit DB lookup failure": design skeptic round 1 (N1) verified `submit`'s own `findByIdShared`/`findGrantRole`
failures land in the inner `.transform`; the comment names those lookups as `submit`'s own so it is not confused
with `gatedSubmit`'s `listByPipelineInternal` (which the outer `transformWith` handles). Do not imply the inner
`.transform` is the only guard keeping the schedule bookkeeping running.

D2 (item 1b). In `PipelineRunBackfill.scala`, say the sole production caller is `OutputService`, reaching this
method via `PipelineRunService.backfillOutputNode`'s pass-through. Keep the `PipelineRunService.scala:282` copy
(accurate there); the verification command for "sole production caller" is a grep over `backend/src/main` for
`backfillOutputNode(` call sites. Alternative considered: delete the duplicated parameter comment from the
pass-through, since its scaladoc already points at the collaborator; rejected as scope beyond the ticket.

D3 (item 2). Re-derive the list with
`ls backend/src/main/scala/com/helio/services/pipelines/*.scala | xargs -n1 basename | sed 's/\.scala$//'`. Every
file is named in the README, grouped by concern (pipeline CRUD + collaborators; run execution + collaborators;
scheduling / auto-run / run guards / heartbeat / reaper; Output family; other). Per HEL-1156 the README states it is
a snapshot as of the change, gives that re-derive command, and claims no completeness. Each grouping/role claim
(e.g. "is `private[pipelines]`") must be checked against the file; the executor records a grep per claim. Where a
role is not obvious, name the file without a role description rather than guess.

D4 (item 3). Remove all four banners (459 < ~1,000; CONTRIBUTING applies). The banners carry two facts not in the
`should` names, per the banner text alone. Design skeptic round 1 (N3) verified the class doc comment (lines 35-48)
and the test/`should` names already carry the gap definitions, the red-first base commit `1bf11f55` and the GUARD
meaning, so the banners are deleted outright with no replacement comment. The executor re-verifies that with a
grep per fact before deleting. No test is renamed, added or removed; test count before/after recorded.

D5 (item 4). Bounded repro of exactly one test (the 430px "surface 7: Connectors page") x 20 repeats = 20 runs.
From the worktree root: `scripts/concertino/start-servers.sh "$WORKTREE_PATH" 6883 9790 HEL-1451`, then
`scripts/concertino/assert-phase.sh servers ...` must PASS (this run's own servers, never another worktree's). Then
`DEV_PORT=6883 nice -n 19 npx playwright test e2e/hel813-mobile-touch-target-floor.spec.ts
-g "at 430px surface 7: Connectors page" --workers=2 --repeat-each=20` (Playwright <= 2 workers). First confirm with
`--list` (same `-g`) that exactly 1 test is selected; record that output and the resolved `baseURL`
(`http://localhost:6883`). Stop servers only via `scripts/concertino/stop-servers.sh "$WORKTREE_PATH" 6883 9790`.
Record command, run count, pass/fail and timings in `evidence/e2e-flake-probe.md`. If 0 failures: document as "not
reproduced in 20" and leave it. If >= 1 failure: capture the trace, root-cause per the systematic-debugging law,
fix only with a probe-confirmed cause (within `DEBUG_ATTEMPTS`); otherwise escalate.

D6. Evidence: `evidence/claims.md` lists every factual sentence in each rewritten comment/README with its
verification command and output, including the README's retained "Does NOT hold" claims (N4).

## Risks / Trade-offs

- A README that lists every file goes stale again; mitigated by the re-derive command and no completeness claim.
- 20 repeats can miss a rare flake; recorded honestly as "not reproduced in N", not "fixed".

## Planner Notes

- Self-approved: removing banners rather than justifying them (file is less than half the threshold).
- Self-approved: leaving the accurate `PipelineRunService.scala:282` copy unchanged.
- No overlap with HEL-1446's changed files (checked `git diff --name-only` of its worktree).
