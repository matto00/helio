## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md (with its Standing Constraints C1-C7), and
specs/{pipeline-draft-save,pipeline-definition-lock-protocol,patch-set-undo}/spec.md. The change dir is untracked, and the
worktree HEAD is 29cb0a60f41e72b0a6b26c15a28360c504fffdb8. I checked them against `docs/live-draft-preview.md` §8.1-8.3 and
§12(c), and against the live tree. The owner rulings (E, reload-only, refuse-dependent-restore-rest) are followed and I did
not re-litigate them.

### What I verified (with evidence)

**Round-2 CRs.** All are genuinely addressed, not just reworded:
- **CR1.**
  - D6(ii) and task 1.1 enumerate every participant that takes any of locks (1)-(5). Each one needs either an order argument
    with file:line or a place in 6.4.
  - The snapshot transaction is named, with a reversed position/id fixture, as D5(d) and in 6.4.
  - `40P01` counts as a failure in every race spec: C6, and the G1 scenario says "never SQLSTATE 40P01".
  - Fixing an existing participant's order requires a red first (C1) or escalation (C3), per the last sentence of D6.
- **CR2.** D3 has a "Pool pinning" paragraph and C7. The 6.5 parity case covers a third-user dashboard panel plus an alert
  rule, with an editor GET followed by an unchanged save that returns 200.
- **CR3.** Task 6.3 enumerates each writer individually, matching §12(c)/§8.3's list plus the D5 app-pool writers. Grouping
  is allowed only through an identical lock path proven in `g1-writers.md`.
- **Round-2 non-blocking notes, also handled:**
  - Count < |ids| gives 404, not 500.
  - The counting uses `pg_stat_user_functions`. `hel1498_lock_panels` is `LANGUAGE plpgsql` (V129), so `track_functions='pl'`
    really does count it.
  - The run response fields are named.
  - Undo after a run is documented.
  - The rewrite restructure is called out.

**Code facts, spot-checked:**
- **Fingerprint contents.** `PatchSetPipelineDefinition.of` hashes name, tag, roots, steps (StepKeys), Outputs (id, name,
  kind, nodeStepId, config) with panelIds and alert rules, and the schedule. It excludes `schema`, `lastRun*` and
  `next_run_at`. So `updateSchemaInternal`, `writeLastRun` and the tick are G2 participants only, which matches D6.
- **Snapshot transaction** (`PipelineRunSucceededWrites.scala:80-150`): the run guard (pipeline `FOR KEY SHARE`), then the
  history insert, which takes key-share on the Outputs in `listByPipelineInternal` order. This is the cycle candidate D5(d)
  names.
- **`deleteInternal`** (`PipelineStepRepository.scala:994-1031`) promotes the lowest-`(position,id)` child into the deleted
  step's slot and deletes every tail subtree (`removalOf`, :1380). The FK is
  `pipeline_steps.parent_step_id REFERENCES pipeline_steps(id)` with no ON DELETE action (V94:172), i.e. NO ACTION and not
  deferrable.
- **Source delete** (`DataSourceRepository.scala:274-282`) runs on the app pool under the source owner's GUC:
  `lockForDeletion(dataSources)` then `DELETE data_sources`, which cascades to `pipeline_roots` (V98:81), then
  `pipeline_steps.root_id` and `outputs.root_id` (V98:119, :145).
- **Root add** (`PipelineRootRepository.scala:78-95`) inserts `pipeline_roots`, whose FK takes key-share on the
  `data_sources` row.
- **Undo dispatch.** `PatchSetUndoService.undo` (:67-77) runs `checkAll` and then `restoreAll`, keyed on
  `(targetKind, op)` (:106). D7's "dispatch before `checkAll`" is a concrete, implementable hook.

### Verdict: REFUTE

The concurrency method is now sound for every writer whose target pipeline is fixed by its request. Two gaps remain. In each
case the plan, followed literally, ships something wrong while every listed spec is green.

### Change Requests

1. **G1: source delete's "(3) for every pipeline rooted on the source" has a set-membership race that no planned spec can
   see.** D5 has source delete take (3) on the pipelines rooted on the source, by id. Nothing says how that set is kept from
   changing between its read and the `DELETE`. Under READ COMMITTED, here is the interleaving:
   - Source delete D reads the rooted set as {} (or without P).
   - Root add R (instrumented: advisory, then (3) on P, then insert root, which key-shares source X) is still uncommitted.
   - D's `DELETE data_sources` waits on R's key-share.
   - R commits and releases (3) on P.
   - The client reads its base (it includes root X).
   - Save S takes (1)-(5) on P and reads a matching fingerprint.
   - D's DELETE re-checks, proceeds, and the FK cascade deletes P's root X, its root-level steps and its Outputs while S is
     in flight. D never held (3) on P.

   The result is a lost update and a wrong journal prior state, a G1/G3 violation. Every 6.3 spec is two-connection
   (writer vs save), so all of them go green. Required, in D5, D6, task 6.3 and task 6.4:
   - (a) Specify the mechanism that freezes the affected set before the save-excluding lock is relied on. Options include:
     - D locking the `data_sources` row before reading the set, with root add taking its source key-share before (3) to
       avoid the obvious cycle;
     - the save itself taking key-share on its roots' `data_sources` rows at a fixed position before its fingerprint read;
     - re-reading the set after (3) and returning 409/retrying if it grew.

     Whichever is chosen, its order must be written into H.
   - (b) Add a three-session race spec, choreographed with `pg_locks`: root add committing between D's set read and D's
     DELETE, with a save on P in flight. Record it red first, per C1/C4.
   - (c) Put root add and source delete on the same source into the 6.4 deadlock mix.
   - (d) Task 1.1 must flag every writer that takes (3) over a set it derived from a read (source delete,
     `WorkspaceTeardownRepository`, any other multi-pipeline writer). Each one gets the same set-stability argument or spec.

2. **D2's delete rule contradicts "the body is the final tree", and its in-transaction order can hit the parent FK.**
   D2 computes "deletes = current ids absent from the draft, expanded by `removalOf` so the cascade equals
   `deleteInternal`'s", applied first ("In-tx order: deletes, creates, re-link/positions, ..."). But `removalOf` deletes every
   tail child's whole subtree. So a draft that removes step S and keeps one of S's tail children T (re-parented elsewhere or
   not) is ambiguous in two ways:
   - **Reading 1:** T is deleted even though the draft contains it. That is silent data loss, plus a later re-link on a
     missing row.
   - **Reading 2:** deletes are exactly current minus draft. Then deleting S first while T still points at it violates the
     NO ACTION `parent_step_id` FK (V94:172) and fails the save.

   Undo (D7) depends on this same machinery, because it re-parents a promoted head child back under a recreated S. Required,
   in D2, task 3.2 and task 6.1:
   - (a) State one rule. Either deletes are exactly current minus draft, and every kept child of a deleted step is re-linked
     to its draft parent BEFORE the delete (so the delete core must not apply `removalOf` promotion), or a draft that keeps a
     step `removalOf` would remove is a 400 naming it.
   - (b) Fix the chain order to match the rule, so no statement can trip the parent FK.
   - (c) Make cascade-422 `stepIds` the steps actually removed under the chosen rule.
   - (d) Add specs: delete a parent while keeping its head child; delete a parent while keeping a tail child re-parented
     elsewhere; a draft Output whose `nodeStepId` is a deleted step (expected 400); and an undo of a save that deleted a
     branching step.

### Non-blocking notes

- **D5 "404 on a raced delete" per writer.** For source delete, a pipeline deleted by a racer between its set read and (3)
  is not "not found" for the source. Mapping it to the source's not-found path would refuse a valid delete. Re-select the
  surviving ids after locking, as PanelRowLocks does, rather than failing. Write the per-writer mapping into
  `g1-writers.md`.
- **`hel1629_lock_pipelines` returns int.** V129 deliberately returns void "so it discloses nothing". The count is reachable
  only from server code, so this is acceptable. State that reasoning in the migration header.
- **Undo recreates steps and Outputs under their original ids, but not their output history, node snapshots or payloads**
  (all cascade-deleted). This is consistent with the ruling. Say it in the §8.3/§8.5 write-up so it does not read as a
  defect.
