## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 1f955abd7a75e54c2be677ea373517e842a677e2 (planning artifacts untracked in the worktree, no code change yet).

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/undo-outputrepo-null-default/HEL-1256`.
- **Both defaults exist.** `PatchSetUndoService.scala:60` has `outputRepo: OutputRepository = null`, and `PatchSetUndoTypes.scala:28` has the same default on `PatchSetUndoContext`. The context is built positionally at `PatchSetUndoService.scala:65-66`.
- **Every undo-path `outputRepo` dereference is enumerated.** `grep outputRepo` over `PatchSetUndo*.scala` finds two dereferences, and the design names both:
  - `restoreBoundOutputs` :298 calls `insertInternal` with no guard.
  - `countPlacementsForStep` :340/:342 has a null branch that returns `0`, then calls `listByPipelineInternal`.
  - `PatchSetUndoConflictCheck` and `PatchSetUndoInverse` contain zero `outputRepo` or `ctx.output` references, so the claim that the context field is never read holds.
  - Collaborator services on the undo path: `PipelineService.addStep`, `updateStep`, `deleteStep`, `delete` and `updateName` (lines 698-760 and 1832-2330) contain no `outputRepo` reads. `PanelService.create` has its own null-guarded `outputRepo` (:254, :635), which skips the outputId-existence check when the repo is null. That service is an explicitly named non-goal (see note 5).
- **The D3 predicate matches what restore dereferences.**
  - Delete: `restoreBoundOutputs` dereferences only when `priorState.boundOutputs` is a `JsArray` with at least one element. A missing key (legacy entry, :261) or a non-array value (:290) gives `Vector.empty`. That is exactly D3's "non-empty JSON array".
  - Create: D3 says this "always needs it". That slightly over-approximates: there is no dereference when `newId` is `None` (:323) or the pipelineId is empty (:340). The extra rejection is conservative, and the spec text states the same rule, so this is not a defect (note 2).
- **No other construction site.** A repo-wide grep for `PatchSetUndoService` / `PatchSetUndoContext` in `*.scala` finds three:
  - `ApiRoutes.scala:560`, which uses the named arg `outputRepo = outputRepoOpt.orNull`.
  - `PatchSetUndoServiceSpec.scala:118`, which passes it.
  - `PatchSetUndoRoutesSpec.scala:110-114`, which omits it (confirmed).
  - `PatchSetUndoContext` is constructed only inside the service.
- **The parity test would fail under mutation.** I read HEL-1239's `PatchSetPreviewOutputContextSpec.scala:223-262`. D5 copies its key-set equality, non-null and `theSameInstanceAs` checks over `productElementNames`, and adds an undo-fields-subset-of-apply check. The apply context's fields are panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo, accessChecker and outputRepo, so undo's six fields are a strict subset. Mutations:
  - Wire null into `build` for outputRepo: the non-null assertion fails.
  - Add a context field without adding it to `supplied`: the key-set equality fails.
  - Add a field to the case class without `build` passing it: compile error, because D1 removes the defaults.
- **Fixtures exist for the new tests.**
  - `PatchSetUndoServiceSpec` extends `HelioRouteTest` (:53) and has real embedded-PG tests for 5.8 (delete with bound Output and placement, :404) and 5.6 (create, removedPlacementCount, :446). Tests 2.2 and 2.3 can journal real applies from those same shapes.
  - `undo` returns `ServiceError.InternalError` through `ServiceResponse.run` (`PatchSetUndoRoutes.scala`), so the result is 500 rather than the 409 that conflicts map to, consistent with HEL-1239's `outputRepoUnavailable` (`PatchSetApplyTypes.scala:117-119`).
- **Coverage sweep.** `grep -rln "PatchSetUndo|patchSetUndo|/undo" backend/src/test` returns the design's five specs plus `LayoutPolicySpec` and `DashboardServiceLayoutPolicySpec`. Those two only mention undo in comments or test labels about `RestorePriorStored`, and neither constructs the undo service. `grep -rli undo e2e/` returns exactly the two layout-undo specs the design names. No e2e test covers patch-set undo, so the design's conclusion is correct.
- **Placeholders and contradictions.** The artifacts contain no TBD or TODO. The proposal, design, tasks and spec delta agree with each other. Every AC is covered: AC1 by 1.1, 1.2 and 1.5; AC2 by 1.3, 1.4, 2.2, 2.3 and 2.4; AC3 by 2.1.

### Verdict: CONFIRM

### Non-blocking notes

1. **The failure-mode narrative is partly wrong. Executor: record the actual red.** On main, a null-repo delete-undo NPE happens inside `repositionF.flatMap`, so it becomes a failed Future. `safeRestoreOne` (:104) recovers it into a 200 response with a `"failed"` outcome and a half-restored lane (step recreated, no Outputs). It is not a 500. The create-undo NPE, once D3 drops the `outputRepo == null` branch, behaves differently: `countPlacementsForStep` is evaluated synchronously in `restoreOne`, so the throw escapes `.recover` and fails the outer Future, which gives a 500. Red-first (2.5) is still valid either way, because the asserted `Left(InternalError)` is absent. The evidence should state which of these was actually observed rather than copying "500" from ticket.md.
2. **The create needs-repo predicate over-approximates.** Undoing a malformed create journal (no `newId` or empty pipelineId) with a null repo will now be refused instead of failing or reporting `0`. This is acceptable and matches the spec text. It is noted so nobody "fixes" it later into a divergence.
3. **The D3 predicate must be total.** It runs before Phase 1, outside `safeRestoreOne`'s recover. Use pattern matching (`case o: JsObject` / `case arr: JsArray`) rather than `asJsObject` / `fields(...)`, so a malformed journal `priorState` does not turn into an unhandled pre-Phase-1 exception.
4. **D2's "single source" is enforced only by a grep (task 1.3), not by the parity test.** The constructor param `outputRepo` stays in scope in the class body, so a future direct read would bypass `context`. Both hold the same value, so there is no runtime divergence risk. Consider not storing it separately, or note this in a comment.
5. **Audit completeness for the AC's "every undo dereference".** The executor's evidence should list `PanelService.create`'s null-guarded outputId check (`PanelService.scala:635`) as a collaborator-owned silent skip on the undo restore path, and mark it out of scope per the non-goals and the follow-up. It should not be left unmentioned.
6. **The guard runs before `PatchSetUndoConflictCheck`,** so for a misconfigured server a 500 takes precedence over a 409. This is intended (configuration fault first) and harmless.
7. The coverage list could also name `LayoutPolicySpec` and `DashboardServiceLayoutPolicySpec` as "undo"-text hits that were reviewed and are unaffected.
