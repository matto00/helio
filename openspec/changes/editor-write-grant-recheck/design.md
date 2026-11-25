## Context

See proposal.md (Why). HEL-1707 (archive `2026-11-24-pipeline-root-race-grant-recheck`) added
`PipelineWriteAccess.currentAction/requireAction` (infrastructure/persistence/pipelines) and `PipelineWriteRefusal`
(services/pipelines), and the deterministic race harness `PipelineGrantRecheckRaceSpec.RaceLocks` (a
`PipelineDefinitionLocks` subclass whose `lockPipelines` first runs a racer committed on a SEPARATE superuser
connection as a step of the write's own transaction). Enumeration (main c939f3781):
`.concertino/runs/HEL-1882/evidence/editor-write-enumeration-hel1882.md` (main checkout).

Owner rulings (2026-11-25, recorded via `concertino answer --channel=chat`):
- Q1 = A: this change is the pipeline side only. Dashboard-editor writes are HEL-1889.
- Q2 = include X1 (Output backfill) and X2 (Output PATCH). X2 is probed first (task 1.1); the rule below is the
  driver's suggestion (HEL-1707 R2 applied to PATCH). If the probe disagrees with the facts below, STOP and report.
- Q3 = insight refresh re-checks at render start only, before any attempt row, quota charge or model call; a refused
  render writes nothing and charges nothing; a finished render keeps its row; automatic triggers out of scope.

Facts (verified on the tree; executor re-confirms each line number before editing):
- `OutputService.create` (OutputService.scala:125-180): `accessChecker.requireAccess("pipeline", .., "Pipeline not
  found")` -> Viewer `ServiceError.Forbidden()` (message "Forbidden"), none -> `NotFound("Pipeline not found")`; then
  `OutputRepository.insertInternal` (OutputRepository.scala:234-249): `withSystemContext(lockPipelines(OutputCreate)
  andThen insertInternalAction ...)`. Production callers of `insertInternal`: `OutputService.create` and
  `PatchSetUndoRestorers.restoreBoundOutputs` (undo of a step delete; it has `user`). `insertInternalAction` is also
  used by single-call pipeline create (caller owns the new pipeline): NOT changed.
- Backfill: `OutputService.triggerBackfill` -> `PipelineRunBackfill.backfillOutputNode(.., user, ..)` ->
  `evaluateNodeRowsForBackfill` reads `pipelineRepo.findByIdShared(pipelineId, Some(user))` (admits a viewer), executes,
  then `persistBackfilledRows` -> `nodeSnapshotRepo.overwriteRows(.., guard = None)` (privileged, one tx) and then
  `outputRepo.updateSchemaInternal` per Output (privileged, separate tx). `overwriteRows` already accepts
  `guard: Option[DBIO[Unit]]` run inside its transaction.
- `OutputService.update`: `outputRepo.findById` (user context; RLS `outputs_select` = `helio_can_access_pipeline`,
  admits a viewer) then `updateOwned` (user context; RLS `outputs_update` = Output owner only; empty body ->
  `findByOwned`). Postgres also applies `outputs_select` to an UPDATE with a WHERE clause, so under RLS a REVOKED
  creator is already refused INSIDE the update (0 rows -> `None` -> 404, OutputRepository.scala:318-322), race or not.
  The real gap is a creator downgraded to VIEWER (still passes `outputs_select` and `outputs_update`), outside or inside
  the race. Task 1.1 probes both. Production callers of `OutputService.update`: OutputRoutes.scala:114, patch-set
  forward apply (PatchSetApplyForward.scala:105) and patch-set rollback (PatchSetApplyRollback.scala:186). There is NO
  patch-set undo of an Output update (PatchSetUndoService.scala:122-135 has no `("output","update")` case). Dev/CI connect as superuser and BYPASS RLS (MISTAKES.md
  "RLS policies never run in dev or CI"): every PATCH test runs on the NOBYPASSRLS fixture (`DraftSaveApiFixture`).
- RLS lets the caller read what `currentAction` needs in user context: `pipelines` via `helio_can_access_pipeline`
  (owner or any grant) and the caller's own `resource_permissions` row (V39 `resource_permissions_pipeline_select`).
  A revoked caller sees no pipeline row -> `PipelineGone` -> refused, which is the desired answer.
- Insight: `InsightRenderService.refresh` admits via `InsightAccess.resolve` (viewer 403, else 404) and calls
  `startRender(output, trigger, runId = None, automatic = false)`; `renderGuarded` writes attempt rows (`noSend`) for
  config/model failures and digest/budget skips, charges `quotaGate.checkAndIncrement(pipeline.ownerId, ..)`, then
  sends. No access check after admission.

## Goals / Non-Goals
Goals: the four writes above refuse a caller who is no longer owner/editor, with the route's existing answer.
Non-goals: see proposal.md; no new lock, no `FOR SHARE`, no new status or message, no migration.

## Decisions

### D1. Output create: re-check after `lockPipelines(OutputCreate)`
`insertInternal` gains a REQUIRED `actor: AuthenticatedUser` (no default; HEL-1707 D3) and runs
`PipelineWriteAccess.requireAction(pipelineId, actor)` right after the lock, before `insertInternalAction`.
`OutputService.create` maps the typed refusal with `PipelineWriteRefusal.refused(ServiceError.NotFound("Pipeline not
found"))` in a `.recover` composed before any generic handler: Viewer -> `Forbidden("Forbidden")` (same status and body
as the pre-check's `Forbidden()`), anything else -> the pre-check's exact `NotFound` body (executor asserts the exact
body the route returns today for a stranger and uses that). This adds no `ServiceError.Forbidden(` producer to
OutputService.scala. `restoreBoundOutputs` passes `user`; a refusal there propagates as a failed Future exactly like
any other insert failure today (no new handling). The executor records what the undo reports in that case; if it is a
500 or an unhandled failure rather than an edit-level error, stop and report.

### D2. Backfill (X1): check before evaluating, and inside the snapshot write
`evaluateNodeRowsForBackfill` keeps its `findByIdShared` read (which already reads the caller's grant: a revoke
committed BEFORE it yields `None` and nothing is written on main too) and, right after it, additionally requires
`currentAction(pipelineId, user).mayWrite` (run on the system context through a context-bearing repository method;
`PipelineRunBackfill` holds no `DbContext`) before executing; otherwise it returns without
executing or writing (logged at info). `persistBackfilledRows` (and `...WithinLimit`, which gain `user`) passes
`guard = Some(PipelineWriteAccess.requireAction(pipelineId, user))` to `overwriteRows`, so a revoke landing during
evaluation aborts the snapshot transaction; the schema updates run only after a successful overwrite (already
sequenced by `flatMap`), so a refusal writes neither. The residual window between the overwrite commit and the schema
update is accepted (the schema is derived from rows already written). A refusal is a failed Future that the existing
`recover`/`recoverWith` logs; callers never see it. Real-run snapshot writes are NOT touched.

### D3. Output PATCH (X2): R2 inside `updateOwned`'s transaction
`updateOwned` (user context) first reads the Output's `pipeline_id`; when the row is visible it runs
`PipelineWriteAccess.requireAction(pipelineId, user)` (user context; explicit predicates, readable per Context), then
the UPDATEs, all in ONE `transactionally` block. The empty-body branch applies the same check inside a transaction
before `findByOwned`. `OutputService.update` maps `PipelineWriteAccessRevoked(_)` to `NotFound("Output not found")`
(same as delete, HEL-1707 D5). Order: the creator rule (RLS) and the access rule both give the same 404, so their order
is not observable. No pipeline lock is added (PATCH takes none today; "after any existing lock"). Patch-set forward apply
and patch-set rollback (`RestorePriorStored`) call `update` and inherit the rule; the executor records what each
reports when refused (expected: their existing NotFound handling). `PatchSetOutputResolvers.findOwnedOutput` keeps its
creator-only pre-validation, so a downgraded creator's patch set passes pre-validation and is refused at apply; this
matches HEL-1707's treatment of delete and is not changed.

### D4. Insight refresh: re-check at render start (Q3)
`startRender`/`renderGuarded` gain `requester: Option[AuthenticatedUser]`: `Some(user)` from `refresh` only, `None`
from `renderForRun` and the tick pass. At the very top of `renderGuarded`, before the pipeline read and before any
`noSend` write, a `Some` requester is checked with `currentAction(pipelineId, requester).mayWrite` on the system
context (pipeline id from `output.node.pipelineId`); a refusal returns a new `RenderResult.Refused` (no row, no quota,
no send, info log naming the Output, never the user's email), and `inFlight` is released by the existing `andThen`.
Residual window between this read and the quota charge is accepted (same as HEL-1707's post-read window).

### D5. Deterministic race tests (no sleeps)
- D1: reuse `RaceLocks` (`lockPipelines` racer) at the service level, as HEL-1707 did for steps. It is `private` in
  `PipelineGrantRecheckRaceSpec`; extract it to testsupport (preferred) and use it from both specs.
- D2: a test-only `NodeSnapshotRepository` subclass (or equivalent injected collaborator) whose `overwriteRows`
  commits the racer on a separate connection FIRST, then delegates with the given guard; and variant (a) whose racer
  fires AFTER `findByIdShared` has returned and BEFORE the new start check (e.g. a `PipelineRepository` subclass whose
  `findByIdShared` calls super, then commits the racer, then returns super's result). "Revoke before the read" is green
  on main (the read refuses) and is recorded as a GUARD, not a red. Variant (a) MUST also assert something only the
  start check produces: the spy `NodeSnapshotRepository` records ZERO `overwriteRows` calls (and/or a counting
  execution backend records zero executions), so the mutation "remove the start check" turns (a) red even though the
  in-tx guard would still refuse the write. Variant (b) pins the in-tx guard (mutation: pass `guard = None`). Await the backfill via
  `backfillObserver`.
- D3: the racer fires between `OutputService.update`'s `findById` and `updateOwned` (e.g. an `OutputRepository`
  subclass overriding `updateOwned` to commit the racer, then call super), on the NOBYPASSRLS fixture. RED on main only
  for the DOWNGRADE racer (and the non-race downgrade); the REVOKE racer is already refused by RLS inside the update and
  is a GUARD, failable by a named mutation. This seam cannot tell an in-transaction check from a service-level check
  made just before `updateOwned`; acceptable (PATCH takes no lock), and no mutation claims to pin in-tx placement.
  A superuser (BYPASSRLS) run never counts as a red for D3.
- D4: the racer fires after admission and before render start. `InsightAccess` is `final` but takes the
  `AccessChecker` trait: a test-only `AccessChecker` wrapper that delegates and then commits the racer is preferred
  (no production change); dropping `final` is the fallback, done in the seam commit. Use a fake transport and a `beta`
  pipeline owner; the discriminating assertions are zero sends and no `output_insights` row, plus the owner's usage
  counter unchanged (meaningful only because the owner is on a counted tier). Completion seam: `InsightRenderService`
  gains a constructor-injected render observer, defaulting to a no-op (like `OutputService.backfillObserver`), called
  with each started render's `(outputId, RenderResult)` when its `done` future completes. Both the red and the green
  run await that observer (bounded await, no sleeps): main yields `Wrote(_, reachedModel = true)`, the fix yields
  `RenderResult.Refused`; the "nothing happened" assertions run only after it. Listed in files-modified.md.
Each red test must be red FOR THE STATED REASON (the write landed; a `201/200`, a row, a send), with the reason
asserted (body/row), not just a status; a 4xx caused by an invalid request body is not a valid red. Red base: main
c939f3781 for 1.2-1.4; for 1.5, c939f3781 plus ONE behaviour-neutral SEAM COMMIT made before the red run (the render
observer defaulting to a no-op, and `final` dropped only if the fallback is used; no check, no refusal mapping, no
behaviour change), named separately in files-modified.md. Backfill tests use a node with NO existing snapshot (else
`backfillOutputNode` returns early and the test passes on main for the wrong reason).

## Risks / Trade-offs

- [A revoke committing after the in-tx read still lets one write land] -> accepted (no `FOR SHARE`, as HEL-1707 Q3).
- [X2 changes behaviour outside the race] -> red-first, stated in the PR body; nobody gains edit rights.
- [`insertInternal` signature change touches test call sites] -> mechanical; compile errors are the net.
- [A rollback refused after a mid-walk downgrade keeps the forward-applied value; a step-delete undo refused in
  `restoreBoundOutputs` is partial] -> accepted (race-only, caller lost edit rights); task 3.3 records both; PR body.
- [RLS-only behaviour invisible in dev/CI] -> PATCH tests on the NOBYPASSRLS fixture; full spec run listed in tasks.

## Migration Plan
None. Backend-only, no schema change; rollback is a revert.

## Planner Notes

- Self-approved: `RenderResult.Refused` as an internal value (no API change); D2's double check (start + in-tx) so a
  refused backfill does not execute the owner's sources at all.
- `ExistenceNotLeakedRoutesSpec` pins per-file `ServiceError.Forbidden(` producer counts: run it whenever a producer
  is added or moved (D1 is designed to add none).

## Gate-Chain Implications Checklist

Not applicable: no `.husky/**` file and no script `.husky/pre-commit` invokes is touched.
