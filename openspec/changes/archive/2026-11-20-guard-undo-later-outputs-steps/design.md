## Context

See proposal.md (Why). HEL-1720 owner rulings (binding here, restated by the ticket): refuse with 409, all-or-nothing; name what the undoing user can read and count the rest; never another tenant's names or ids. HEL-1720's own design listed Outputs as a non-goal; this ticket brings them (and steps) in.

Current state (main 763c69f6f, read from source; the executor SHALL confirm each by probe before relying on it):
- `PatchSetUndoService.undo` runs `PatchSetUndoConflictCheck.checkAll` (Phase 1); any blocker → `ServiceError.Conflict` → 409, nothing restored. Phase 2 walks edits in reverse.
- `checkPipeline` (used for `pipeline` create) compares only `name` via `findByIdOwned`. There is no fingerprint/stale comparison on this arm, so a later-added Output most likely reaches no blocker and is deleted by the cascade (`outputs.pipeline_id ON DELETE CASCADE`, V94; `pipeline_steps.pipeline_id ON DELETE CASCADE`, V23). The HEL-1792 stale-check interaction (a fingerprint comparison pre-empting the new check with `409 PATCH_SET_STALE`) is expected NOT to apply on this path, but this SHALL be proven by the red test going through the real `undo` entry point (and once via the REST route), not assumed.
- `PatchSetUndoBoundPanels.doomed` already computes, per create arm, the Outputs whose panels would be deleted: all Outputs of the pipeline (`pipeline` arm), Outputs on the step's real removal set `removedByDeleteInternal` (`pipelineStep` arm). It discards the Outputs themselves after using them to find panels.
- `pipeline` create with inline `steps`/`outputs` inserts them in one transaction (`PipelineCreateWrites`). Its journaled `resultingState` is a `PipelineSummaryResponse` that does NOT list the created step or Output ids. So today nothing in the journal says which steps/Outputs the create itself made.
- `outputs` has `owner_id` and `created_at`; `pipeline_steps` has `created_at` (no `owner_id`, owner-only RLS via the pipeline, V35).
- Editors can create Outputs on a shared pipeline (`OutputService.create`: Editor or Owner) and (to be confirmed) add steps.

## Goals / Non-Goals

**Goals:**
- No `pipeline` or `pipelineStep` create undo deletes an Output or a step the patch set did not create; the whole undo is refused instead.
- "Created by the patch set" is decided from the journal, exactly, for rows written after this change.
- Proven on `helio_app_test` (NOBYPASSRLS) with a two-user case, red first.

**Non-Goals:**
- `dataSource` create undo (HEL-1796). The `PatchSetUndoService` split/tidy (HEL-1797).
- Other rows cascaded by a pipeline delete that a later user could add (schedules, extra roots, runs, payload history, auto-run debounce). Runs/history are pipeline by-products, not user-authored resources; a schedule or root added later is noted in the PR as a candidate follow-up, not fixed here.
- Alert rules (`alert_rules.target_output_id`, `alert_events`, V94:391/394) cascade with an Output. Alert rules are user-authored, so one added later (by the applier or anyone) on a set-created, excused Output is still deleted silently. The ticket's ACs cover Outputs and steps only; this is out of scope and is filed as a named follow-up ticket at Delivery (via followup triage), and the PR body states it. `output_snapshot_history` (V115) and `output_insights` (V145) are run by-products, like runs.
- `output` create undo deletes only its own Output (and its panels, HEL-1720), so it needs no Output guard. `dashboard` create undo deletes panels only (HEL-1720 covers it).
- Any response-schema, route, helio-mcp or web change.

## Decisions

### D1. Doomed set, reused from the HEL-1720 computation
Refactor `PatchSetUndoBoundPanels.doomed` minimally so its per-arm Output computation is exposed rather than recomputed, and add the step computation:
- `pipeline` create: doomed Outputs = every Output of the pipeline (`listByPipelineInternal`); doomed steps = every step of the pipeline (`pipelineStepRepo.listByPipelineInternal`).
- `pipelineStep` create: doomed steps = `removedByDeleteInternal(stepId)` minus the step itself; doomed Outputs = Outputs whose `node_step_id` is in the full removal set (the same set the panel check already uses).
Internal (ACL-bypassing) reads, as HEL-1720, because other users' rows must be seen. Alternative rejected: a separate parallel computation in a new class -- it would drift from the panel check's removal set.

### D2. Excused set: exact from the journal, legacy fallback documented
Excused = ids created by the same application:
1. every `output` create edit's `newId` and every `pipelineStep` create edit's `newId`;
2. NEW: the steps and Outputs a `pipeline` create (inline) or `pipelineStep` create made as part of that create. At apply time, immediately after the create returns and inside the same `apply` call, the apply reads the created pipeline's (or step's) steps and Outputs through internal reads and journals their ids in one new optional `JournaledEdit` field (e.g. `createdChildren: Option[{stepIds, outputIds}]`, default `None`, so existing JSON rows parse unchanged; no migration). At that instant the resource is milliseconds old and its id is known only to this call, so the listing is exactly what the create made.
Rejected alternatives: (a) `owner_id`-only ("excuse rows the applier owns") -- misses same-user later additions, which the AC requires blocking, and steps have no `owner_id`; (b) timestamp-only for all rows -- `created_at` and `appliedAt` are both JVM `Instant.now()` (`PipelineRepository.createAction`, `PipelineStepRepository.insertInternalAction`, `OutputRepository.insertInternalAction`, `PatchSetApplyService.journalSuccess`), so the only skew is between instances (a later row written by another Cloud Run instance carries that instance's clock), but the journal can give an exact answer, so new rows use it; (c) a fingerprint comparison against a journaled post-apply fingerprint -- would also flag harmless changes (step config edits) that the undo arms do not refuse today, widening behaviour beyond the ticket.

Where the ids are read: in `PatchSetApplyService.applyResolved`'s loop, right after `applyOne` succeeds for a `PipelineCreate`, into a separate `edit.index`-keyed accumulator (the existing `rawConfigs` pattern, `PatchSetApplyService.scala` ~147-149), read only by `journalSuccess`. `EditOutcome`, `applyOne`'s return type, the `applied` tuple and the `/apply` response are unchanged (no new key on the wire). Only the `pipeline` arm journals `createdChildren`; the `pipelineStep` arm journals nothing new (`addStep` creates only the step, already excused by `newId`), so its rule below applies to every row, old or new.

Point 1 is defensive only: same-set `output`/`pipelineStep` creates cannot target a pipeline or step the same set creates (`PatchSetOutputResolvers` resolves `target.parentId` against a stored pipeline, ~135-143; `PatchSetPipelineStepResolvers` runs `checkAdd` against a stored pipeline, ~150-155; `$ref` substitution exists only for an Output id bound into a later panel create, `PatchSetRefs.scala` 8-10). It is kept (blocking is the safe direction either way, and it costs nothing) and covered by a helper-level test labelled as not reachable through apply.

**Legacy fallback (journal rows with no `createdChildren`), decided:**
- `pipeline` arm: an Output is excused iff its `owner_id` is the applier AND its `created_at <= appliedAt`; a step is excused iff its `created_at <= appliedAt`. Inline rows are written by the same process before `appliedAt` is taken, so they are always excused. Residual, stated in the PR: a same-user addition written by another instance whose clock runs behind the applying instance, inside that skew, would be excused. This affects only journal rows written before this change.
- `pipelineStep` arm: no timestamp rule. Every descendant step and every Output in the removal set that no same-set `newId` excuses is blocking.
- Both rules get tests.

### D3. Message, naming, disclosure
One blocker string per guarded edit, alongside (never replacing) the panel blocker and the arm's own check, joined with `; ` as today:
`edit <i> (<kind> create): <k> Output(s) were added after the patch set was applied and would be deleted: Output "<name>", ...; remove them before undoing` and, for steps, `<k> pipeline step(s) were added after the patch set was applied and would be deleted: <op> step at position <p>, ...; remove them before undoing`.
- Outputs are named only when `outputRepo.findById(id, user)` (sharing-aware) returns them; the rest are counted (`and N Output(s) you cannot see`). Same `NameCap` (10) and overflow count as `describeBlocking`. Reuse `describeBlocking`'s structure by generalising its naming half (a small shared formatter taking a per-id describe function), not by copying it.
- Steps have no name; they are described by op and position and only when the undoing user can read the pipeline (always true for the applier of a pipeline create; for a `pipelineStep` create the applier was at least an editor). Unreadable steps are counted.
- No Output or step id in the message or in any INFO+ log. The Phase-2 failure reason is a fixed phrase plus a count, like `boundDuringUndo`.
- Since undo is applier-only and Output RLS follows pipeline access, the "unreadable Output" branch is probably unreachable through real routes; the test drives the helper directly for it and says so (HEL-1720 D5 precedent).

### D4. Phase 2 re-check, same residual as HEL-1720
`ifStillUnbound` in `PatchSetUndoService` (already applied to the `pipeline` and `pipelineStep` create arms) is extended to also re-run the Output/step computation immediately before the delete and report the edit `failed` if non-empty. This is the only `PatchSetUndoService` change (keep it minimal for HEL-1797). The window from that re-check to the service-owned delete transaction remains: the same accepted residual HEL-1720 D4 documents for these arms (cite V130's RESIDUAL paragraph, do not restate it).

### D5. Tests
- Red first, committed before implementation: on `helio_app_test` (assert `rolbypassrls = false` in the spec), A applies a pipeline-create patch set, A grants B editor, B creates an Output via `OutputService.create` on the app role, A undoes through `PatchSetUndoService.undo`: today the undo succeeds and B's Output is gone. The red run output is recorded.
- After the fix: 409, the pipeline, its steps, B's Output and every journaled resource unchanged (row-level assertions).
- Same-user later Output; later step (same user; and editor if editors can add steps); a `pipelineStep` create on an existing pipeline with a later Output on it; end-to-end through apply: a pipeline create with inline steps and Outputs, nothing added afterwards, undo succeeds (the `createdChildren` excusal); a helper-level test (labelled not reachable through apply) for D2 point 1; one combined message case where a later step, a later Output and a panel all block (three strings joined with `; `); legacy journal row without `createdChildren` (both excused inline rows and a blocking later row); message has no ids; Phase-2 re-check string.
- Mutations: drop the new blocker (red), drop the `createdChildren` excusal (the end-to-end inline-only success case goes red), break the legacy fallback.
- One route-level check (`PatchSetUndoRoutes` → 409 body) to prove the REST path reaches this blocker and not `PATCH_SET_STALE`.

## Risks / Trade-offs

- [An undo becomes impossible while later Outputs remain] → message says what to remove; owner chose refusal (HEL-1720).
- [Legacy fallback misjudges] → blocks in doubt; tested; residual stated in PR if the timestamp fallback is used.
- [Phase 2 window] → documented residual (D4).
- [Journal format change] → optional field with default; old rows parse; apply/rollback/preview untouched except where the journal is built.

## Migration Plan

None. No schema change (V147 unused). Rollback is a code revert; spray `jsonFormatN` ignores unknown fields on read and reads a missing `Option` field as `None` (the HEL-1493 `inlineSources` precedent), so old code reads rows written by this version and vice versa.
