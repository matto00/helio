## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 68255cf79b0077b9b37ae7a35433ca7faad58bc1 (worktree = main; change dir untracked). I checked everything below against source again. I did not rely on round 1.

### What I verified (with evidence)

**Round-1 CR1 is resolved.**
- design.md D3(a) now names `panelRepo.findByIdInternal(panelId)` and says explicitly why `findById(panelId, None)` is wrong. tasks.md 1.2 matches ("a = `findByIdInternal`").
- `PanelRepository.scala:130`: `def findByIdInternal(id: PanelId): Future[Option[Panel]]` returns the same type as `findById` (`:145`), so the mutation compiles in place.
- `PanelService.formSchema` (`PanelService.scala:143-158`): when the lookup finds the foreign text panel, it hits `case Some(_)` and returns `BadRequest`, i.e. 400.
- The absent id still returns `None`, i.e. 404 `"Panel not found"`.
- The spec's per-row check (`ExistenceNotLeakedRoutesSpec.scala:228-232`) requires `foreign.status shouldBe 404` and `foreign shouldBe nonexistent`. The row therefore goes red under (a).

**Mutation (b) and the producer pin.**
- `grep -c 'ServiceError.Forbidden(' PanelService.scala` gives 4, which matches the design's "4 to 5" claim.
- The pin test (`:334-338`) compares `forbiddenProducerCounts()` to `expectedForbiddenProducers`, so (b) does trip it.
- D3 now asks for the new row's failure to be named separately from the pin's failure. That was round 1's optional note, and it is now covered.

**D2 row shape is valid.**
- The `Row` signature (`:353-363`) takes name, method, path, target and sites, with `ownerControl` defaulting to true.
- The route exists: `PanelRoutes.scala:143` `path(PanelIdSegment / "form-schema")`.
- The seeded panel is `kind 'text'` (`:132-135`). The owner therefore reaches the non-form arm and gets 400, so `ownerControl = true` holds.
- `PanelService.scala` is already named in `sites` by other Panel rows (`:419-424`), so the completeness guard stays green.
- The stranger gets 404 on both arms through `findById(panelId, Some(stranger))`, so the unmutated row is green.

**D1 is sound: dropping the parameter loses no attribution.**
- `PipelineRunService.scala:213-229`: the parameter is read only as `Some(triggeredByUserId.getOrElse(user.id).value)`.
- Production callers: `PipelineProposalService.scala:608` and `PipelineSchedulerService.scala:263-266`. Neither passes the parameter.
- Test callers are positional (`PipelineRunEditorPersistenceSpec.scala:411`, `PipelineRunServiceSpec.scala:924`). The only other grep hit is a doc comment in `PipelineApplyProposalSpecBase.scala:249`. The removal is compile-safe.
- Mutation guard: `PipelineRunEditorPersistenceSpec.scala:409-413` asserts `Vector(Some(owner.id.value))`, so storing `None` turns it red.

**D4 archived wording is factual.**
- The non-evaluation hits for `countOwnerInFlightRealRunsInternal` in the archived change are exactly `design.md:237` and `tasks.md:37`.
- `FormSubmitEditorRlsSpec.scala:205-220` asserts:
  - one run `(Some(editor), auto_run)`;
  - an owner `pipeline_run_rate_window` count > 0;
  - an editor count = 0.
- The optional `ownerInFlightRealRunsQuery` clause is real: `PipelineRunRepository.scala:172`, private, and used by both the cap and the internal count.

**AC coverage, scope and contracts.**
- AC1: D1, tasks 1.3 and 3.1.
- AC2: D2/D3, tasks 1.1 and 1.2.
- AC3: D4, task 2.1.
- No scope drift. No behavior change, so `skip_specs` and the absence of a schema delta are justified.
- No placeholders, TODOs or internal contradictions between proposal, design and tasks.

### Verdict: CONFIRM

### Non-blocking notes
- Task 3.2's "every spec calling `recordUnrunnable` or `PipelineSchedulerService`" matches about 20 test files (e.g. `FireTimeRunConfigGateSpec`, `PipelineSchedulerService*Spec`, `DatasetWriteAutoRun*Spec`).
  - The compile is the real guard for a signature-only change. `FireTimeRunConfigGateSpec`, `PipelineRunEditorPersistenceSpec` and `PipelineRunServiceSpec` are the specs that matter at runtime.
  - The executor should list what it actually ran, as the task already requires, and run it under C4 (`-J-Xmx3g`, `nice -n 19`).
- D1's "(or another id)" mutation is redundant with the `None` mutation. The `None` mutation alone is enough.
