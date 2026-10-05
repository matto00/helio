## Context

See proposal.md for the motivation and ticket.md for the premise-validation findings against main @ 1f955abd. HEL-1239
(`openspec/changes/archive/2026-10-03-fix-patch-set-preview-output-context/`) set the pattern: no `= null` default,
one `PatchSetApplyContext.build` construction path, a typed `PatchSetApplyContext.outputRepoUnavailable`
(`InternalError("Output repository is not configured")`), and a parity test in `PatchSetPreviewOutputContextSpec`
that asserts each context field is non-null and identical to the supplied instance.

Undo's `outputRepo` dereferences on main (`PatchSetUndoService.scala`):
- `restoreBoundOutputs` (:298): unguarded `outputRepo.insertInternal`, reached only after `pipelineService.addStep`
  has already recreated the step. Per the design-gate skeptic, the NPE lands in a failed Future that
  `safeRestoreOne` recovers into a `failed` outcome, so the response is 200 with a step recreated without its
  Outputs/placements, not a 500. Executor: record the observed mode (constraint C2).
- `countPlacementsForStep` (:340): `outputRepo == null` silently returns `0`, so the `removedPlacementCount` is
  under-reported.
- `PatchSetUndoContext.outputRepo` is constructed but never read by `PatchSetUndoConflictCheck` or
  `PatchSetUndoInverse`.

Construction sites: `ApiRoutes.scala:560` (passes `outputRepo = outputRepoOpt.orNull`, so explicit null is possible
when there is no DbContext), `PatchSetUndoServiceSpec.scala:118` (passes it), and `PatchSetUndoRoutesSpec.scala:110`
(OMITS it).

## Goals / Non-Goals

**Goals:** Omitting the collaborator is a compile error. No undo path NPEs or silently degrades on a null repo.
A parity test fails on an unwired new context field.

**Non-Goals:** The same `= null` convention on other services (PanelService, PipelineService, DashboardService,
DashboardProposalService, DashboardContentsService, PipelineRunService, ProposalPanelSupport) is out of scope; it is
noted as a follow-up. No change to undo's conflict or ACL semantics.

## Decisions

**D1: Required parameter plus one construction path.** Remove `= null` from `PatchSetUndoService(..., outputRepo)` and
`PatchSetUndoContext(..., outputRepo)`. Add `PatchSetUndoContext.build(...)` (all parameters required) as the only way
the service builds its context, exposed `private[services] val context` like `PatchSetApplyService.context` so the
test can reach it. A caller with no DbContext still passes `null` explicitly (ApiRoutes); that is handled by D3.
*Alternative rejected:* `Option[OutputRepository]`. It would diverge from HEL-1239's apply-side shape and ripple into
ApiRoutes' `orNull` convention for no added safety over D3's typed rejection.

**D2: The context is the single source.** `PatchSetUndoService` reads the repo only as `context.outputRepo` in
`restoreBoundOutputs`, `countPlacementsForStep`, and the D3 guard, so the parity-tested field is the one actually
dereferenced. There is no second constructor-field read. *Alternative rejected:* dropping the unused context field.
That would leave the service's own field outside any parity check.

**D3: Typed rejection in Phase 0, before any mutation.** In `undo`, after `applicationRepo.findById` and before
`PatchSetUndoConflictCheck.checkAll`, compute whether any journaled edit needs the repo:
- `pipelineStep` + `create`: always needs it, because the outcome reports `removedPlacementCount`.
- `pipelineStep` + `delete`: needs it if `priorState.boundOutputs` is a non-empty JSON array. A legacy entry with no
  `boundOutputs` key, or an empty array, does not need it.

If any edit needs the repo and `context.outputRepo == null`, return
`Left(PatchSetApplyContext.outputRepoUnavailable)`. This reuses HEL-1239's constant and does not add a second message.
Because it runs before Phase 1/2, nothing is restored. `countPlacementsForStep` then drops its `outputRepo == null`
branch, since the guard makes that branch unreachable; keep only the `pipelineId.value.isEmpty` branch.
*Alternative rejected:* add it as a Phase-1 conflict blocker. Blockers map to `409 Conflict`, but a missing server
collaborator is a configuration fault (500), consistent with HEL-1239.
*Alternative rejected:* allow pipelineStep-create undo with a null repo (the delete itself would succeed via
cascade). That keeps the silent `0` count, which is exactly the silent-degrade class this ticket removes.

**D4: Fix the omitting call site.** Pass `new OutputRepository(ctx)` in `PatchSetUndoRoutesSpec` (D1 makes the
omission a compile error). ApiRoutes already uses a named argument; verify that only.

**D5: Tests.** Add them to `PatchSetUndoServiceSpec`, which has embedded-Postgres fixtures for apply and undo. Any NEW
spec file must extend `com.helio.testkit.HelioRouteTest` (`RouteTestBaseGuardSpec`).
- Parity: construct an apply service and an undo service from the same distinct supplied repo instances. Assert the
  undo context's `productElementNames` set equals the supplied key set, and that each field is non-null and the same
  instance. Also assert every undo-context field name is a field of `PatchSetApplyContext` (undo is a subset of
  apply), so a repo added to one and not wired in the other shows up.
- Typed rejection: with an undo service built with `outputRepo = null` against the same DB, journal a real apply of
  (a) a `pipelineStep` delete with a bound Output and placement, and (b) a `pipelineStep` create. Assert each undo
  returns `Left(InternalError(OutputRepoUnavailableMessage))`, and assert in the DB that nothing was restored: no
  recreated step for (a), and the created step still present for (b).
- Non-needing application: a panel-only application undoes successfully with `outputRepo = null`.
- Red-first evidence: the executor shows the typed-rejection test failing (NPE/500 or partial recreate) with the D3
  guard removed, then passing with it. The transcript goes into the evidence.

**D6: Coverage sweep.** Per the driver, grep both the unit tests and repo-root `e2e/` for the affected paths. Unit:
`PatchSetUndoServiceSpec`, `PatchSetUndoRoutesSpec`, `PatchSetUndoInverseSpec`, `Hel914Ac1EndToEndSpec`,
`PatchSetApplyServiceSpec`. `e2e/`: the only `undo` hits (`hel1028-layout-undo-redo-visual-revert.spec.ts`,
`state-surface-contrast-guard.spec.ts`) are layout undo, not patch-set undo, so no e2e change is needed. The executor
re-runs this grep and records the result.

## Risks / Trade-offs

- [A prod deployment without a DbContext would now refuse lane undos instead of half-restoring them] -> This is
  intended. Prod always has a DbContext.
- [D3's needs-repo predicate drifts from what restore actually dereferences] -> The predicate lives next to the
  restore functions and the typed-rejection test covers both kinds.

## Planner Notes

- Self-approved: reuse HEL-1239's message constant rather than an undo-specific one.
- Self-approved: no migration (V116 not needed), no API shape change, no frontend change.
