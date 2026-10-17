## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md, specs/{pipeline-draft-save,pipeline-definition-lock-protocol,patch-set-undo}/spec.md
(untracked in worktree at HEAD 29cb0a60f41e72b0a6b26c15a28360c504fffdb8), against `docs/live-draft-preview.md` §8 and §12(c) and the live tree.
Owner rulings (E, reload-only, refuse-dependent-restore-rest) were not re-litigated; the artifacts follow all three.

### What I verified (with evidence)

- **Planner's code claims, confirmed:** `updateInternal` :487, `deleteInternal` :994 (calls `PanelRowLocks.lockForDeletion` at :1015
  internally), `reorderTrunkInternal` :866, `spliceInsertAtInternal` :638 (all `PipelineStepRepository.scala`) each run their own
  `withSystemContext(...transactionally)`. `PatchSetPipelineDefinition.of(summary, ctx)` takes the summary (name, tag, roots) as a
  **pre-read parameter**, then does six more separate `Future` reads (steps+roots, outputs, configs, schedule, panel ids, alert rules).
  `PipelineCycleGuard.lockAction` is a single global `pg_advisory_xact_lock(PipelineCycleValidator.AdvisoryLockKey)`.
  `rewriteUpsertTargetAction` (:124) does `SELECT ... pipeline_steps ... FOR UPDATE` (:135), then `cycleCheckForUpsertAction` (advisory),
  then the step UPDATE, and it runs inside `DataSourceRepository.applyWriteBacks` under `withUserContext(owner)` (app pool), after
  any earlier write-back in the same transaction may already hold a `data_sources FOR UPDATE` (`lockSource`, :552).
  The run guard takes the pipeline row `FOR KEY SHARE` (`PipelineRunRepository.scala:359`), which is compatible with `FOR NO KEY UPDATE`.
- **D4 RLS claims, confirmed:** `patch_set_applications_owner` (V79:38) is `USING (owner_id = current_setting(...))` with no separate
  WITH CHECK, so under the owner GUC an editor-owned journal insert fails. `DbContext.withSystemContext` = privileged pool, role
  `helio_privileged` with BYPASSRLS. A privileged-pool save is sound for the save itself.
- **RLS on the lock targets (V39:87-89, V94:246-248):** `pipelines_update` and `outputs_update` are **owner-only**. In PostgreSQL a
  row-locking `SELECT ... FOR [NO KEY] UPDATE` is filtered by the UPDATE policy as well as SELECT, so a non-owner on the app pool
  locks **zero rows, silently**.
- **Editor-capable writers that run on the app pool under the EDITOR's GUC:** `PipelineRootWrites.addRoot` (:110-119 allows editors;
  `PipelineRootRepository.add` :78 runs `withUserContext(user)`), `removeRoot` (:162-171 allows editors; :216
  `runTransactionally(user.id.value)` = `withUserContext`). `attachRoot` takes the root source via `findByIdOwned(dsId, user)`, so an
  **editor's own source can be a root of the owner's pipeline**; that editor deleting the source runs
  `DataSourceRepository.delete` (:274-282) under the editor's GUC and cascades through `pipeline_roots` into the owner's pipeline.
- **Step-position uniqueness:** none on `pipeline_steps` (only `pipeline_roots UNIQUE (pipeline_id, position)`, V98:84), so D2's
  apply order has no transient-unique hazard. `outputs.node_step_id ... ON DELETE CASCADE` (V94:209), so step deletes cascade Outputs
  and panels, which `lockForDeletion(pipelines = Seq(p))` covers as a superset.
- **Alert rules:** `AlertRuleRepository` insert/update/delete run on the app pool; insert takes KEY SHARE on the Output (blocked by H(4)),
  update/delete take the rule row (blocked by H(5)). No alert-rule retarget writer exists. The evaluator was not enumerated by me
  either; D6 Phase A owns it (acceptable).
- **D8:** `ServiceError.TooManyRequests(retryAfterSeconds: Long, reason: String)` (ServiceError.scala:69) matches the mapping.
- **D10 ordering argument:** correct for its stated case (fingerprint-before-data yields a spurious 409, never a lost update) except
  under content ABA (non-blocking note below). `GET /api/pipelines/:id` returns only the summary; steps/Outputs come from other routes,
  so the contract note is the only control and is appropriately placed in the schema.

### Verdict: REFUTE

The architecture (one privileged transaction, H's global order, probe-first verification, mutation-red specs) is the right shape, and
D4 is correct. But the verification method as written can certify G1 while it is false in production, through three concrete holes
(1, 2, 3), and two composition details would break the PanelRowLocks invariant or hash a stale summary (4, 5). All are artifact edits.

### Change Requests

1. **App-pool writers under a non-owner GUC cannot take the pipeline-row lock (G1 silently void).** H says instrumented writers take (3)
   "`FOR NO KEY UPDATE`", and D6's race specs do not say which role they run as. `addRoot`, `removeRoot` (editor-capable, app pool,
   editor GUC) and an editor's `DataSourceRepository.delete` of a source rooted in the owner's pipeline would each run
   `SELECT ... FROM pipelines ... FOR NO KEY UPDATE` against owner-only `pipelines_update` and lock nothing. A race spec on a
   BYPASSRLS embedded role, or with the owner as actor, goes green anyway. Required in design.md D5/D6/D11 and tasks 4.1/6.3:
   (a) the pipeline-row lock for any writer not on the privileged pool is taken through a mechanism that cannot silently lock
   zero rows (a SECURITY DEFINER helper in the `hel1498_lock_panels` style, which makes V137 likely rather than "none planned", or a
   checked row count that fails the transaction on 0); (b) every race spec for an app-pool writer runs on the non-BYPASSRLS app role
   **with an editor actor** wherever that writer is editor-capable, and its red is recorded under that role; (c) D11 is restated to
   cover this trigger, including the non-BYPASSRLS `helio` Flyway requirement.

2. **"Excluded by a row conflict" is not a valid G1 exclusion (D6).** Under READ COMMITTED, a writer whose step-row UPDATE is still
   uncommitted when the save takes locks (1)-(5) and reads the fingerprint is not seen. The save's own later UPDATE of that row then
   blocks, and on the writer's commit it re-evaluates and **overwrites**: a lost update with a wrong journal prior state. If the save
   never touches the row, the result is a silent mix. Only locks the save takes **before** its fingerprint read exclude a writer.
   Required: delete "or a row conflict" from D6's exclusion list, or restrict it explicitly to row locks acquired before `ofAction`.
   The G1 requirement and each race spec must also choreograph **both** interleavings deterministically: writer-holds-uncommitted
   then save, and save-holds then writer, each with the second session shown blocked via `pg_locks`/`wait_event_type`. The C2 red
   must be recorded on the writer-first interleaving, which is the one the lock exists for.

3. **G2 enumeration and the deadlock spec are scoped too narrowly.** Task 1.1 enumerates writers of *fingerprinted state*, but G2
   concerns every transaction that takes any lock in H. Several of those write nothing fingerprinted. Phase A's table must also list
   each of these lock participants and its sequence:
   - the node snapshot transaction: pipeline `FOR KEY SHARE`, run `FOR SHARE`, then the history insert's KEY SHARE on Outputs
     (`PipelineRunSucceededWrites.scala:80-150`), which H(4) `FOR UPDATE` conflicts with;
   - `OutputRepository.updateSchemaInternal`, an Output UPDATE;
   - `writeLastRun` and the reaper's `UPDATE pipelines` (`PipelineRunRepository.reapStaleRunsInternal`, which holds `pipeline_runs`
     rows then takes the pipeline at NO KEY UPDATE, which conflicts with H(3));
   - the alert evaluator;
   - the `applyWriteBacks` chain (`data_sources FOR UPDATE`, then rewrite).

   Task 6.4 / the G2 scenario also lists only panel create, pipeline delete, Output delete, source delete and save. It must add every
   writer that gains the lock in 4.1, plus `rewriteUpsertTargetAction` and a save that takes the advisory lock, because those are the
   new edges D5(a)/(b) themselves flag as candidate cycles.

4. **The composable delete actions would call `lockForDeletion` more than once per transaction.** `deleteInternal` calls
   `PanelRowLocks.lockForDeletion(steps = ...)` mid-chain (:1015), and `deleteWithPanelsInternal` calls it at
   `OutputRepository.scala:320`. PanelRowLocks' first invariant is "exactly ONE call per transaction". D3 extracts `deleteAction`
   "with its cascade", and the save composes it after H(1). Required: D3 specifies lock-free core actions
   (`deleteCoreAction`, `deleteOutputCoreAction`, or similar) that the save composes under its single up-front superset lock. The
   `Future` wrappers keep their own `lockForDeletion` so they stay behavior-preserving. Add a spec or assertion that one save
   issues exactly one `hel1498_lock_panels` call, for example a statement counter or a mutation that adds a second call and shows
   the deadlock spec going red.

5. **`ofAction` must read the summary inside the transaction.** `of(summary, ctx)` hashes a caller-supplied `PipelineSummary` (name,
   tag, roots). A `DBIO` port with the same signature would hash a pre-lock summary inside an otherwise locked read, so a concurrent
   rename or root change between that read and the locks goes undetected. Required: D3 states that `ofAction(pipelineId)` re-reads
   name, tag and roots in-transaction after the locks. The parity spec must cover a state where the summary changed after a pre-read.

6. **The advisory-lock decision is taken before the locks it orders against (D5(2)).** Whether the plan "adds or changes an upsertsource
   write edge" depends on `current`. If that is read before the locks, the under-lock state can differ, and the save cannot take the
   advisory after (3) without inverting the order. Required: specify that the plan is recomputed under the locks, and that if it
   needs the advisory lock that was not taken, the transaction aborts (409, or a bounded retry from the top). Never take (2) late.
   Also state that the decision considers upsertsource creates as well as target edits.

7. **Undo vs the cascade gate, and task ordering.**
   (a) Undo re-runs the save with the prior definition, which deletes any steps and Outputs the save created. D7/D9 do not say
   whether undo derives its own `confirmCascade` or would 422 on its own restore. Specify it. Since a matching post-save fingerprint
   proves nothing is bound to them, a server-derived confirmation limited to those ids is the natural rule.
   (b) In tasks.md, 4.1 ("add the lock only to writers whose race spec is red") precedes 6.3 ("race spec per writer class; each red
   without its lock"). Move or cross-reference the race-spec authoring and red recording into Phase A / before 4.1, so the executor
   cannot add locks first, as C1 and D6 require.

### Non-blocking notes

- D10's claim that "the safe order only yields a spurious 409" holds except under content ABA. The sequence is: state X (fingerprint
  read), Y (steps read), back to X (save matches). The revert is then overwritten. That is inherent to a content fingerprint with no
  version counter. Document it as a residual rather than claiming none.
- Compute the GET fingerprint via `ofAction` in one transaction (the current `of` does seven independent reads, so it can hash a torn
  state; safe, but it produces avoidable spurious 409s).
- H(1) `lockForDeletion(pipelines = Seq(p))` on every save locks all bound panels and their dashboards, even on a config-only save.
  That is correct for G1 (the fingerprint includes panel ids) but blocks dashboard edits for the save's duration. Keep the save
  transaction short, and record the measured hold time.
- `validateStepCrossOwnerRefs` and `UpsertTargetCheck` run outside the transaction (D9). That matches the create path's existing
  TOCTOU and is acceptable; name it as inherited.
- H(4) `FOR UPDATE` on Outputs also briefly serializes run history inserts (KEY SHARE) behind a save. That is expected; mention it in the
  §8.3 write-up.
