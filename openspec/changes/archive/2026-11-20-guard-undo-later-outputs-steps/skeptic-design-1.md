## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md, specs/patch-set-undo/spec.md, against live source at HEAD
763c69f6f77be04a57e6e5d208262f86c3fb86e0 (= main). All paths below are under `backend/src/main/scala/com/helio/`.

### What I verified (with evidence)

**(a) A later-added Output reaches no Phase-1 blocker today. Confirmed from source.**
- `PatchSetUndoConflictCheck.guarded` (lines 156-172) runs `checkOne` and then `PatchSetUndoBoundPanels.blocker` for the
  `pipeline` create arm. `checkPipeline` (lines 302-313) compares only `name` through `findByIdOwned`. The bound-panels
  blocker only fires when a doomed Output has a panel. A bare Output added later produces no blocker.
- `PATCH_SET_STALE` is used only on the draft-save path (`services/pipelines/draft/DraftRestore.scala:20`,
  `api/routes/ServiceResponse.scala:113`). `PatchSetUndoService.undo` (lines 70-86) sends only `pipelineDefinition` rows
  to `DraftRestore`. No fingerprint comparison exists on the per-edit path, so nothing pre-empts the new check.
- Phase 2: `ifStillUnbound` → `restorePipelineCreateUndo` → `PipelineService.delete` (`PipelineService.scala:132`) →
  `PipelineRepository.delete` (`PipelineRepository.scala:545`), an owner-scoped DELETE. Outputs and steps cascade.
- Editors can add both kinds of row. `OutputService.create` (`OutputService.scala:146-149`) refuses only Viewer.
  `PipelineStepWriteChecks.checkAdd` checks editor/owner, and `PipelineStepCreate.addStepReporting:31` says so in a comment.
  The red test in D5 is therefore reachable through real services. Its plan to prove this through `undo` and once through
  the route is right.

**(b) D2 journaling is sound. The legacy fallback's primary rule is false.**
- Journaling at apply time is sound. `PatchSetApplyForward.scala:86-89` (pipeline create) and `:98-101` (step create)
  return the new id. No grant on a brand-new pipeline exists until after the apply. `addStep` creates no Output
  (`PipelineStepCreate.scala` has no Output insert). A read straight after the create therefore lists exactly what the
  create made.
- An optional `JournaledEdit` field has a precedent: `inlineSources: Option[...] = None` with `jsonFormat8`
  (`infrastructure/persistence/patchsets/PatchSetApplicationRepository.scala:119-137`, HEL-1493). Spray reads a missing
  Option field as `None` and ignores unknown fields, so both forward and rollback compatibility hold.
- **The "same-transaction `created_at`" fallback is false.** Each of the three inserts takes its own JVM `Instant.now()`
  and writes it as `created_at`. Nothing uses a DB default or `now()`:
  - `PipelineRepository.createAction`: `val now = Instant.now()`, line 472, into `createdAt` at line 479
  - `PipelineStepRepository.insertInternalAction`: `val now = Instant.now()`, line 450
  - `OutputRepository.insertInternalAction`: `val now = Instant.now()`, line 267, into `Output(..., now, now, ...)` at line 282

  So inline steps and Outputs never share the pipeline's `created_at`, apart from a coincidental tie at a coarse clock.
- The rationale for rejected alternative (b), "`created_at` is DB time, `appliedAt` is JVM time", is also wrong. Both
  are JVM time. `appliedAt` is the JVM `Instant.now()` in `PatchSetApplyService.journalSuccess`, line 238, taken after
  every edit has applied. Inline rows are written earlier by the same process, so `created_at <= appliedAt` holds for
  them. The only real skew is between instances: a later row written by another Cloud Run instance carries that
  instance's clock.

**(c) The doomed set for the `pipelineStep` arm is right.**
- `removedByDeleteInternal` (`PipelineStepRepository.scala:1113-1120`) shares `removalOf` with the delete itself. The
  removal set is the target plus its tail subtrees; the promoted head child survives. "Removal set minus the step" for
  steps, and "Outputs whose `node_step_id` is in the full removal set" for Outputs, match what the cascade deletes. An
  Output on a surviving head child is correctly not doomed.
- `checkAdd` includes `rejectIfReparents`, so a set's step create never adopts existing steps. Every descendant at undo
  time is therefore a later addition or one of the same set's own step creates (excused through `newId`).
- I looked for an edge case where a same-set `pipelineStep delete` undo recreates a step under a new id and trips the
  Phase-2 re-check. It cannot happen: `resolvePipelineStepDelete` (`PatchSetPipelineStepResolvers.scala:62-75`) resolves
  its target against stored rows, so it cannot target a step the same set creates.

**(d) Naming and disclosure match HEL-1720/HEL-1792.**
- `describeBlocking` (`PatchSetUndoBoundPanels.scala:82-95`) names readable items up to `NameCap` (10), counts the
  overflow, counts unreadable items, and never shows an id. `boundDuringUndo` (line 108) is a fixed count-only phrase.
- D3 follows this pattern: Outputs are named only through the sharing-aware `findById(id, user)`, the rest are counted,
  and the Phase-2 failure is a fixed phrase plus a count. It generalises the formatter instead of copying it. This is
  consistent with HEL-1792 design D1 and D4 (archive `2026-11-20-draft-undo-panel-naming/design.md`).

**Other checks**
- Scope covers every acceptance criterion:
  - Two-user red test on `helio_app_test` with a `rolbypassrls` assertion: D5 and task 1.2.
  - 409 with nothing changed, under the HEL-1720 naming rules: spec scenarios 1-2 and D3.
  - Same-user later additions blocked, with only set-created items excused: spec scenario 2 and D2.
- The ticket's "check steps" item is handled by bringing steps in, which is consistent with the all-or-nothing owner
  ruling. Stopping at HEL-1796/HEL-1797 is respected.
- No placeholders, and no contradiction between proposal, design and tasks.
- No product question is left open that needs escalation.

### Verdict: REFUTE

These are small changes, limited to the artifacts. The overall design is sound.

### Change Requests

1. **design.md D2, legacy fallback: replace the false primary rule with the one that holds, and state it as decided.**
   The rule "created_at equal to the created pipeline's created_at ... Postgres `now()` is the transaction start" is
   false; see the three citations in (b). Revise D2 as follows:
   - **`pipeline` arm.** Make the existing alternative the rule: an Output is excused if its `owner_id` is the applier
     and its `created_at <= appliedAt`; a step is excused if its `created_at <= appliedAt`. Both timestamps are JVM time
     on the applying instance (`PatchSetApplyService.scala:238`). State the residual exactly: a same-user addition,
     written by another instance whose clock runs behind the applying instance, inside that skew. This affects only
     journal rows written before this change.
   - **`pipelineStep` arm.** Drop the "the step's own `created_at`" clause. `addStep` creates only the step, which is
     already excused through `newId`. Under the legacy rule, every descendant step and every Output in the removal set
     that no same-set `newId` excuses is blocking. No timestamp is needed.
   - **Rejected alternative (b).** Correct the rationale: `created_at` and `appliedAt` are both JVM time. The real
     argument against timestamps for new rows is cross-instance skew, and that the journal can give an exact answer.
   - **Task 1.1.** Turn the `created_at`-sharing probe into "confirm the chosen fallback with a test", since the source
     answers it already.
2. **design.md Non-Goals: name alert rules, the other dependents an Output delete cascades.** These tables reference
   `outputs(id) ON DELETE CASCADE`:
   - `alert_rules.target_output_id` (V94:391) and `alert_events` (V94:394)
   - `output_snapshot_history` (V115:24)
   - `output_insights` (V145:28)

   History and insights are run by-products, the same category as runs. Alert rules, however, are user-authored, like
   panels. An alert rule the applier adds later on a set-created (excused) Output is still deleted silently by this
   design. That is a same-user later addition, the class the third AC asks to block. HEL-1792 treated alert rules as
   dependents for the draft undo. HEL-1720 never mentioned them. Either bring alert rules into this check, or add them
   explicitly to Non-Goals with a one-line reason and a named follow-up, so the gap is decided rather than missed. The
   ticket's ACs cover only Outputs, so a Non-Goal plus follow-up is enough here.

### Non-blocking notes

- D3's step description "`<op>` step at position `<p>`" uses a position that is scoped to the sibling group (HEL-904
  1.6), so it can be ambiguous in a branched pipeline. Adding the parent step's op, or saying "a branch step", would
  read better. This is cosmetic.
- For the `pipelineStep` arm, `createdChildren` will always be empty, because `addStep` makes no Outputs. Journaling it
  is harmless, but D2 could say it is recorded only for symmetry.
- D2 says to read the children "immediately after the create returns". Reading them inside the forward loop (in
  `PatchSetApplyForward`'s `PipelineCreate` case, or the loop's accumulator) rather than in `journalSuccess` keeps the
  list exact. Reading later would also pick up later same-set creates. Those are excused anyway, so this is harmless
  either way. Say which one, so an implementer does not have to choose.
- The Migration Plan's question mark ("ignored by the old code? --") can become a statement: spray `jsonFormatN`
  ignores unknown fields. The `inlineSources` precedent proves it.
