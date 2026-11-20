## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 31094b15440b7016e4bfac7f1e5fb7631d22a414 (the change dir is untracked). Artifacts: ticket.md,
proposal.md, design.md (D1-D9), tasks.md, specs/proposal-dry-run-validation/spec.md. All paths below are under
`backend/src/main/scala/com/helio/` unless stated.

### What I verified (with evidence)

- **Spawn guard**: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/patchset-preview-step-datasource-checks/HEL-1722`.

#### Round-1 change requests: resolved in substance, not only reworded

1. **CR1 (graph checks in `resolveAll` would make apply refuse sets it accepts today): resolved by D7 option (a).**
   - D7, spec delta paragraph and scenario "Same-pipeline step edits in one patch set still apply", and task 1.5 all
     say the same thing.
   - D8 adds end-to-end same-set entries through `PatchSetApplyService`. These are green on main and must stay green:
     the two-position create, and dropping a lane then adding the reverse lane.
   - D9 adds a mutation that always passes `Run`. It must turn the two-position entry red.
   - The skipped set is lane, placement and rejectIfReparents on create, and lane only on update. That is the whole
     graph-dependent set: on update, `position` is enforced in the repo and stays apply-only under D6.
2. **CR2 (D6 handed a decision to the executor): resolved.**
   - D6 now decides apply-only and gives the real reason: an owner-identity edge read on the privileged pool under a
     lock.
   - Confirmed in code: `spliceInsertReportingInternal` runs `cycleCheckForUpsertAction(..., actingUserId)` inside
     `ctx.withSystemContext(locks.lockPipelines(...))` (`infrastructure/persistence/pipelines/PipelineStepRepository.scala:731-760`).
3. **CR3 (`rejectIfReparents` not enumerated): resolved.**
   - D1 computes it in `checkAdd` from the resolved anchor.
   - D8 has a corpus family for it, and D7 lists it as graph-dependent.
   - Equivalence check: `StepPlacement.reparentedIds` (`services/pipelines/StepPlacement.scala:63-72`) selects the same
     rows as the repo's `existingChildren` in all three arms:
     - anchor `Some(a)` matches `siblingsQuery(Some(a))`;
     - `None` with a root id matches the root-filtered parentless query;
     - `None` with no root id matches all parentless steps;
     - a tail attach gives an empty set, and the repo uses `attachTailInternal`, which never rejects.
   - The message comes from `ReparentRejected` (`PipelineStepRepository.scala:1529`), mapped to 422 by
     `PipelineService.classifyDbError` (`services/pipelines/PipelineService.scala:335`).
4. **CR4 (blank-name update parity): resolved.**
   - D4 runs `validateUpdate` first on both sides, before the ownership lookup.
   - This matches `DataSourceService.update` today: the blank-name 400 at `services/sources/DataSourceService.scala:597-600`
     comes before `findByIdOwned`.

#### Focus check: does the D7 skip open a preview-passes/apply-fails hole worse than today?

No.
- Today `resolvePipelineStepCreate` and `resolvePipelineStepUpdate` run no graph check at all
  (`services/patchsets/PatchSetPipelineStepResolvers.scala`: authorize, rawConfig, decode and second-source only).
- Under D7, graph checks run unless an earlier step edit of the same pipeline exists. In that case preview is exactly
  as blind as today and no blinder.
- Non-graph checks (type, config, decode, access, secondary ownership, upsert target) run in every case. So the set of
  inputs that pass preview and then fail at apply shrinks strictly.

#### Focus check: can D7 make apply refuse something it accepts today?

No. Apply runs `resolveAll` (`services/patchsets/PatchSetApplyService.scala:87`) and then applies the edits strictly
in index order (`applyResolved` loop, same file, about lines 125-150; no reordering). So edit k is forward-applied
against the stored state as changed by edits 0..k-1. I checked every edit kind that could change what a later step
edit's moved checks read:

- **Step graph (lane, placement, re-parent)**: only `pipelineStep` create, update and delete change steps, and D7
  skips after any of them.
  - `UpdatePipelineRequest(name: String)` (`api/protocols/pipelines/PipelineProtocol.scala:86`) cannot touch roots or
    steps.
  - `pipelineStep` targets and `parentId` are real ids. `PatchSetRefs` substitutes only a panel's `config.outputId`,
    so a step edit cannot name a pipeline created earlier in the same set.
  - `pipelines.id` is TEXT (`V22__pipelines.sql`), so tracking pipeline ids by exact string is sound.
- **A root disappearing through a `dataSource` delete**: not possible. `DataSourceService.delete`
  (`services/sources/DataSourceService.scala:638-649`) refuses a source that is still referenced, with a 409.
- **Upsert target**: `UpsertTargetCheck.check` (`domain/steps/UpsertTargetCheck.scala`) reads only the target
  source's owner and kind.
  - `UpdateDataSourceRequest(name: Option[String])` cannot change the kind.
  - A source created in the same set cannot be named by a step.
  - A deleted target refuses at apply today anyway.
- **Access (grants) and the stored kind used by the update type-change check**: no patch-set edit changes either.
- **Earlier edit that only makes the later edit fail at apply** (pipeline delete, step delete): today's acceptance is
  already "refused". Only the message can move to resolve time.

D7 therefore loosens exactly the checks that could disagree, and the checks it keeps are not affected by earlier
edits. C9 holds.

#### Other checks

- **Ticket ACs mapped to tasks**:
  - AC1 → D1/D3, tasks 1.1/1.4.
  - AC2 → D2 plus the inventory, tasks 0.1/1.2.
  - AC3 → D4, tasks 2.1/2.2.
  - AC4 → D5, task 2.3.
  - AC5 → D8/D9, tasks 0.2/0.3/3.2.
  - No AC is uncovered, and no task goes beyond the ticket.
- **D4 row cap**: `staticMaxRows` is `DataSourceService.DatasetMaxRows` (`DataSourceService.scala:74`). It is not a
  constructor parameter, so the resolver using the constant cannot drift from the service.
- **D5**: `rootSchemas()` takes no preflight indices (`services/patchsets/PatchSetPipelineResolvers.scala:149-157`), so
  calling it on `Right(None)` is feasible as written.
- **Forbidden wording**: `ServiceError.Forbidden(message: String = "Forbidden")` (`services/ServiceError.scala:24`).
  `requireEditorAccess` uses `Forbidden("Forbidden")`, so `edit N: Forbidden` parity holds.
- **Other callers of the changed resolvers**: only `PatchSetPreviewService:49` and `PatchSetApplyService:87` call
  `resolveAll`. Undo and rollback reach the refactor only through `PipelineService.addStep`/`updateStep`, and D-Risks
  plus task 3.3 run their specs read-only.
- **Placeholders or deferred decisions**: none that block implementation. The executor only has to record two facts
  (`Forbidden` text and the before/after wording); no design choice is left to it.

### Verdict: CONFIRM

### Non-blocking notes

1. **Reparent check vs cycle guard: a message-precedence shift on the direct route.**
   - Today `spliceInsertReportingInternal` runs the write-back cycle guard before the reparent refusal (lines 731
     then 741).
   - Under D1 the reparent refusal moves into `checkAdd`, so it now fires before the cycle guard.
   - Effect: a create that both closes a write-back cycle and would re-parent now gets the reparent 422 instead of the
     cycle 400.
   - Acceptance is unchanged; only the message changes for doubly-invalid input. D1's sentence "error precedence is
     unchanged" should say so, and the inventory should record it.
2. **Order of ids in the reparent message.** The repo's `ReparentRejected` lists `existingChildren` in query order (a
   Seq), while `reparentedIds` returns a Set. Preview and the direct route share `checkAdd`, so they agree with each
   other. Even so, sort the ids deterministically (or keep the query's order) so the message is stable for two or more
   moved children, and the corpus entry cannot flake.
3. **Visibility and construction.**
   - `StepReferenceChecks` and `LaneScope` are `private[pipelines]`, and `requireEditorAccess` is private to
     `PipelineService`.
   - A `private[services]` class whose public constructor takes a `private[pipelines]` type will not compile
     ("escapes its defining scope").
   - Fix: give `PipelineStepWriteChecks` a `private[pipelines]` constructor plus a `private[services]` factory in
     `services/pipelines`. The factory builds `PipelineServiceSupport`, `StepReferenceChecks` and the
     `findGrantRole`-based editor check from the repos. `PatchSetApplyContext.build` calls the factory.
4. **D4 order within the update resolver.** Validating the name before ownership means patch presence also moves
   ahead of the ownership lookup. A missing patch on an unowned source therefore goes from 404 to 400. This is
   harmless (it is caller input), but list it among the precedence flips in the inventory.
5. **D7 tracking key.** Take the pipeline id from the resolved action (`PipelineStepCreate.pipelineId`, or
   `existing.pipelineId` for update and delete), as D7 says, not from raw `target.parentId` text. This is already
   implied; it is restated because a mismatch here silently turns the skip off.
