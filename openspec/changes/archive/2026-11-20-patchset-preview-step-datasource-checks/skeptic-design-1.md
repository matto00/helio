## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 31094b15440b7016e4bfac7f1e5fb7631d22a414 (change dir untracked; artifacts: ticket.md, proposal.md,
design.md, tasks.md, specs/proposal-dry-run-validation/spec.md). All paths below are under
`backend/src/main/scala/com/helio/` unless stated.

### What I verified (with evidence)

- **Spawn guard**: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/patchset-preview-step-datasource-checks/HEL-1722`.
- **Context claims (design "Context")**: confirmed against live code.
  - `services/pipelines/PipelineStepCreate.scala` `addStepReporting`: order is type (400) -> `rawConfigProblem` (422)
    -> decode (400) -> `refChecks.referenceChecksF` (access -> secondary ownership -> lane -> upsert) -> `persistNewStep`
    -> `StepPlacement.resolveCreateAnchor` over a fresh read -> repo insert. D1's precedence statement matches.
  - `services/pipelines/PipelineStepWrites.scala` `updateStep`: findByIdInternal 404 -> findByIdShared None -> same 404
    (HEL-1002 masking) -> editor 403 -> type change 400 -> rawConfig 422 -> decode 400 -> `referenceChecksF` with
    `LaneScope.of(current, existing.parentStepId, Set(self), Some(self))` -> `updateInternal`. D2 matches.
  - `services/patchsets/PatchSetPipelineStepResolvers.scala`: create runs editor auth, rawConfig, second-source only;
    update runs requireVisibleStep, rawConfig, decode, second-source only. Matches the ticket.
  - `services/patchsets/PatchSetDataSourceResolvers.scala`: create checks only the dataset type; update checks
    ownership only. `DataSourceService.update` (line 597) rejects blank name BEFORE ownership; `validateStatic`
    (line 1396) is public; `DatasetMaxRows = 500` (line 1433). D4 matches.
  - `services/patchsets/PatchSetPipelineResolvers.scala:162-170`: `Right(None)` short-circuits before `rootSchemas()`;
    `PipelineCreateDryRun.preflight` returns `Right(None)` exactly when steps and outputs are both empty. D5 is correct.
  - `PatchSetApplyService.scala:87` calls `PatchSetApplyResolvers.resolveAll` before forward apply (line 145) — so
    anything added to the resolvers is enforced by apply too, not only preview.
  - `PatchSetApplyContext.build` (PatchSetApplyTypes.scala:146) has dataSourceRepo/pipelineRepo/pipelineStepRepo;
    `PipelineServiceSupport` needs (stepRepo, dataSourceRepo, auditService) and `audit` tolerates null, so D3's
    "built from the repos it already has" is feasible. `DraftSaveService` builds the context but uses only
    `PatchSetPipelineDefinition`, not the step resolvers — unaffected.
  - Undo (`PatchSetUndoService.scala:265,299,304`) and rollback (`PatchSetApplyRollback.scala:161,259,266`) call
    `pipelineService.addStep/updateStep`, so D1/D2's service refactor reaches HEL-1720's flows through the service
    (no undo file edited; behaviour-preserving if the refactor is). Not mentioned in the design; see notes.
- **D1/D2 behaviour preservation (direct route)**: the extraction is sound. Precedence is preserved; `persistNewStep`
  keeps its own fresh read and placement resolution, so the TOCTOU guarantee is unchanged; the cost is one extra
  roots+steps read per add (acknowledged in Risks).
- **D3 HEL-1002 masking**: holds. `checkUpdate` inherits `updateStep`'s identical `Pipeline step not found: <id>` for
  absent vs. invisible; the id is caller input, so the unified message leaks nothing new.
- **D8/D9 failability for single edits**: each of the four gaps is red on main against a direct-service oracle
  (placement/lane/type pass preview today; blank-name update and invalid static create pass preview today; roots-only
  inline refusal passes preview today). Deleting a resolver call re-greens preview's acceptance and turns parity red.
  Sound, for the single-edit corpus.

### Verdict: REFUTE

### Change Requests

1. **D7 contradicts C9 / AC5 / the proposal non-goal: moving graph-dependent checks into `resolveAll` makes APPLY
   refuse multi-edit sets it accepts today.** `resolveAll` judges every edit against the stored graph, and apply runs
   `resolveAll` (PatchSetApplyService.scala:87) before its sequential forward apply. Today placement and lane are
   judged only inside `addStep`/`updateStep`, i.e. against the graph after edits 0..N-1 have landed. Concrete
   regressions under the design as written:
   - Pipeline with N steps; edit 0 `pipelineStep` create `position: N`; edit 1 `pipelineStep` create `position: N+1`.
     Today: both apply. After: edit 1 refused at resolve with `position must be between 0 and N`
     (`StepPlacement.scala:52-55`), by preview AND apply.
   - Edit 0 updates step D to drop its `lane` input naming T; edit 1 updates T with a `lane` to D. Stored state: D is
     a lane dependent of T -> refused. Sequentially: accepted today.
   D7 says it "does not refuse such sets" and that preview and apply "can differ", but under D3 they cannot differ:
   both refuse. That is a new apply refusal, which C9 forbids, and the parity corpus (single-edit sets plus one
   two-edit set on different pipelines) is built so it never sees it. Required revision: pick one and write it
   into D7, the spec delta and the tasks.
   (a) Skip the graph-dependent checks (placement, lane, rejectIfReparents) at resolve for a `pipelineStep` edit
   when an earlier edit in the same set creates, updates or deletes a step of the same pipeline. Record that skip in
   the inventory; the service still enforces them at forward apply.
   (b) Refuse such sets as a whole, the way HEL-1639's `rejectEditedOutputNodes` does. That is a behaviour change, so
   it needs an ESCALATION and an owner ruling, not self-approval.
   Either way, add a corpus entry that is green on main and must stay green: the two-position-create set applies
   end to end. Add a mutation (drop the same-pipeline guard) that turns it red.

2. **D6 hands a design decision to the executor ("the executor records it and the design gate decides").** That is
   the deferred decision this gate is meant to catch. A lock-free predicate does exist:
   `PipelineCycleValidator.checkNoCycle(readEdges, writeEdges, ...)` is pure, and `PipelineCycleGuard.checkAddReadAction`
   (PipelineCycleGuard.scala:117-136) composes it with `findReadEdgesVisibleTo`/`findUpsertWriteEdges` after
   `lockAction`. Decide now and remove the hand-off. Apply-only is acceptable if D6 states the real reason: the edges
   are read on the privileged connection as the PIPELINE OWNER (`actingUserId = pipelineOwnerId`), which a
   lock-free preview read by a grantee caller would not reproduce, consistent with HEL-1638 row 1.11.

3. **The `rejectIfReparents` refusal is missing from the D1/D6 enumeration.** `spliceInsertReportingInternal`
   (PipelineStepRepository.scala:741-743) fails with `ReparentRejected` before the insert when
   `rejectIfReparents && existingChildren.nonEmpty`. Patch-set step creates carry the same
   `CreatePipelineStepRequest`, so AC1 ("every request addStep would reject before its first write") covers this
   refusal. Classify it in D1 or D6. It is dry-runnable as `rejectIfReparents && !attachAsTail &&
   StepPlacement.reparentedIds(anchor, ...).nonEmpty`, or it is apply-only with a reason. Add it to the inventory
   and, if it is dry-run, to the corpus. It is graph-dependent, so CR1's rule applies to it.

4. **D4 creates a parity divergence that D8 cannot meet as written.** `DataSourceService.update` checks the blank
   name BEFORE ownership (400). D4 has the resolver check ownership first (404). A blank-name update of an unowned
   or absent source therefore gets 400 from the service and 404 from preview. D8 asserts the same status and message
   for every entry. Either call `validateUpdate` before the ownership lookup in the resolver (it reads only the
   input, so this leaks nothing and matches the service), or list this case as a named exception in D8 and in the
   spec's "Parity with apply" scenario. The first option is simpler and needs no exception.

### Non-blocking notes

- D2: state `checkUpdate`'s return type. The resolver needs `existing` for `priorState`, and `updateStep` needs the
  pipeline owner for `updateInternal(actingUserId = ...)`. A `CheckedUpdate(existing, pipeline, typedConfig?)`
  avoids a second lookup. Also state the visibility: `StepReferenceChecks`/`LaneScope` are `private[pipelines]`, so
  `PipelineStepWriteChecks` must be `private[services]` (or wider) for `patchsets` to call it.
- D3 changes preview's precedence for step create (type/config now come before the 404/403 access check) and for
  update (patch presence before existence). This matches the service and leaks no data, but existing
  `PatchSetPipelineStepGrantSpec`/`PatchSetResolverMessagesSpec` cases that combine a bad payload with no access may
  flip. List them in the inventory along with the wording changes.
- The `Forbidden` wording: the service uses `Forbidden("Forbidden")` and the resolver uses `Forbidden()`. Confirm
  the default message so `edit N: Forbidden` parity holds, or keep `Forbidden` unprefixed on both sides and say so.
- D1/D2 change `addStep`/`updateStep`, which HEL-1720's undo and `PatchSetApplyRollback` call. Name that in Impact
  and run `PatchSetUndo*`/rollback specs in 3.3 (read-only for this lane; just run them).
- D5 adds a live fetch (charged at preview, uncharged at apply's resolve) for a roots-only rest/sql create that
  previously had none. This is consistent with the with-steps path; note it in the inventory.
- D9 "runs on the NOBYPASSRLS test role where the existing parity specs do" is vague. Name the harness the spec uses.
