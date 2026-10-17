## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md, specs/{pipeline-draft-save,pipeline-definition-lock-protocol,patch-set-undo}/spec.md
(untracked, worktree HEAD 29cb0a60f41e72b0a6b26c15a28360c504fffdb8), against `docs/live-draft-preview.md` §8 (8.1-8.7) and §12(c) and the
live tree. The three owner rulings (E, reload-only, refuse-dependent-restore-rest) are followed and were not re-litigated.

### What I verified (with evidence)

- **Round-1 CRs 1-7 are all addressed in the text.** CR1: D5 has the SECURITY DEFINER `hel1629_lock_pipelines` with a count assertion, C5.
  CR2: D6 has "excluded by a row conflict is NOT exclusion", both orders, and the red recorded writer-first (C4). CR3: D6(ii) has the G2
  participant list. CR4: D3 has the lock-free cores plus the exactly-one `hel1498_lock_panels` counting spec. CR5: D3 has `ofAction(pipelineId)`
  re-reading name, tag and roots. CR6: D5 has the re-plan rule (advisory never after (3), otherwise 409). CR7: D7 has the derived confirmation,
  and tasks 4.1 is gated on 6.3.
- **Code claims, spot-checked:**
  - `deleteInternal` is at `PipelineStepRepository.scala:994`, with `lockForDeletion` at :1015.
  - `rewriteUpsertTargetAction` is at :124. It takes the step row `FOR UPDATE` (:135), then `newDatasetSourceAction`, then
    `cycleCheckForUpsertAction`, which takes the advisory lock (:146).
  - `PipelineCycleGuard.lockAction` is one global `pg_advisory_xact_lock` (:31-32).
  - `pipelines_update` (V39:87-89) and `outputs_update` (V94:246-248) are owner-only.
  - V129 SECURITY DEFINER/`row_security = off`/owner-to-`helio_privileged` is the bracket D11 cites.
  - V136 is the highest migration, so V137 is free on this branch.
  - `PanelRowLocks` invariants (exactly one call, first write) are at `PanelRowLocks.scala:11-28`.
- **`PatchSetPipelineDefinition.of`** (`PatchSetPipelineDefinition.scala:26-51`) hashes `summary.name/tag/roots` from a caller-supplied summary.
  It does six privileged `*Internal` `Future` reads, each its own `withSystemContext`. Panel ids are sorted (`PanelRepository.scala:115-121`)
  and alert rules are sorted by id (`OutputRepository.scala:170-178`), so the fingerprint is deterministic.
  The privileged pool is load-bearing: the fingerprint includes panels on OTHER users' dashboards and their alert rules.
- **Panel `batchUpdate`** (`PanelMutationRepository.scala:88-160`) locks the named panels `FOR UPDATE` in id order and takes no dashboard lock.
  A swap into or out of the pipeline's Outputs is therefore excluded by (1) or (4) and forms no cycle with H. V122's dashboard-locking trigger is
  `AFTER DELETE` only.
- **Run node-snapshot transaction (unchanged existing code):**
  - `PipelineRunSucceededWrites.scala:80-150` reads the Outputs via `listByPipelineInternal`, which is in **`position` order**
    (`OutputRepository.scala:102-107`). It groups them per node in that order and runs, in one `withSystemContext` transaction:
    the run guard (pipeline `FOR KEY SHARE`), the `node_snapshots` replace, then `outputHistoryRepo.insertAction(entries)`
    (`OutputHistoryRepository.scala:72-77`).
  - `output_snapshot_history.output_id REFERENCES outputs(id)` (V115:24), so each history row's FK check takes `FOR KEY SHARE` on its Output,
    in `position` order.
  - H(4) takes the same Outputs `FOR UPDATE` in **id** order, and `FOR UPDATE` conflicts with `FOR KEY SHARE`.
  - For a node with two Outputs whose position order differs from their id order (ids are random UUIDs, so this is common), the following is a
    lock cycle: snapshot KEY SHAREs O_a; the save takes O_b FOR UPDATE and waits on O_a; the snapshot waits on O_b. Result: `40P01`.
  - Derived from code plus PostgreSQL row-lock semantics. Not probed by me; CR 1 requires it be probed.

### Verdict: REFUTE

The revision is substantially better: H is well-ordered against `PanelRowLocks`, the exclusion argument is now correct, and the
verification discipline (probe first, writer-first red, mutation) is right. Three gaps remain where the plan, followed literally, can
certify G2/G1 while they are false or ship a save that 409s every editor. Each is an artifact edit.

### Change Requests

1. **G2: the deadlock spec covers only writers the plan *changes*, but the save is itself a new lock-taker against *unchanged*
   transactions. One such cycle is visible in the code today.**
   - D6(ii)/task 1.1 enumerate G2 participants, but nothing says what is done with that list.
   - 6.4/D6 put only the ticket's five, newly-locking writers, `rewriteUpsertTargetAction` and an advisory save in the deadlock spec.
   - The run's node-snapshot transaction gains no lock, so it is in neither list. Yet it key-shares a node's Outputs in `position` order while H(4)
     takes them `FOR UPDATE` in id order: a save during a run deadlocks (evidence above).
   - The race specs cannot catch it either. The G1 scenario's "the writer waits or fails cleanly" lets a `40P01` read as a clean failure.

   Required:
   (a) D6/task 1.1: for every G2 participant whose lock sequence touches any of (1)-(5), the evidence file must either show its sequence
   is a prefix-consistent subsequence of H (a written argument, file:line), or that participant joins the deadlock spec. The node-snapshot
   transaction must be named explicitly, with a fixture of two or more Outputs on one node whose position order is the reverse of their id
   order, together with the alert evaluator and the `applyWriteBacks` chain.
   (b) The G1 scenario and 6.3 must assert that no participant aborts with `40P01`. A deadlock is a failure, never a "clean failure".
   (c) If the probe confirms the cycle, the remedy (for example, sorting history entries by Output id, which changes an existing writer) goes
   through C1 with a recorded red, or C3 escalation. Add it as D5 probe target (f).

2. **`ofAction` as a `DBIO` moves the pool choice to every caller, and D10 does not pin it.**
   - Today `of` is privileged by construction: each read is `withSystemContext`.
   - As a `DBIO`, `ofAction` runs on whatever pool its caller uses. If the GET (D10) or patch-set preview runs it under `withUserContext` on the
     app pool, RLS hides panels on other users' dashboards and other users' alert rules.
   - The GET fingerprint would then differ from the save's privileged in-transaction fingerprint. Every save of a pipeline with a foreign-bound
     panel would 409 permanently: "reload" returns the same mismatching fingerprint, and under the reload-only ruling there is no way out.

   Required:
   - D3/D10 must state that `ofAction` runs only on the privileged pool (or under an RLS-off context) at every call site: GET, preview/apply,
     save and undo.
   - 6.5 must include a parity case on the non-BYPASSRLS fixture: the owner's Output has a panel on a third user's dashboard and an alert rule.
     An editor GETs the fingerprint and saves it unchanged → 200.

3. **The race-spec scope is narrower than §12(c) requires and is ambiguous.**
   - §12(c) and §8.3 require a race spec for **each panel writer listed in the G1 table, not only panel create and swap**:
     `insertPlaced`, `duplicate`, `batchUpdate`, `insertBatchPlaced`, `PanelRepository.replace`, dashboard duplicate, dashboard import,
     `replaceContents`, dashboard delete. They also require alert-rule insert/update/delete, plus the step, Output, root, schedule, rename
     and source-delete writers.
   - Task 6.3 and D6 say only "per G1 writer class". An executor can read that as one spec per table.

   Required: 6.3/D6 must enumerate the writers that each get their own race spec. As a minimum this is §8.3's explicit list plus the
   editor-capable app-pool writers in D5, each with its required order(s) and role. Any grouping must be justified in `g1-writers.md` by an
   identical lock path, file:line.

### Non-blocking notes

- **D5 count assertion.** `hel1629_lock_pipelines` returning fewer rows than ids also happens legitimately when a racer deleted a pipeline
  and committed. That is the same READ COMMITTED skip `PanelRowLocks` documents as "not an error". For source delete (many pipelines), a
  strict `count = |ids|` turns a lost race into a hard failure. Either re-select the still-existing ids after locking and compare against
  those, or document that a mismatch aborts with a retryable error.
- **D3 counting seam.** A mutable test-only counter on the `PanelRowLocks` singleton is racy under parallel specs. `pg_stat_user_functions`
  (`track_functions = 'pl'`) or a per-session statement log on the embedded cluster is self-contained.
- **D1 placeholder.** `{started: true, runId...}` should name its fields (mirror the existing run-submit response) before 5.1 writes the schema.
- **Undo after a run.** A NewSource `upsertsource` step rewritten by the run-after-save changes the fingerprint, so that save becomes
  un-undoable (409). This is consistent with §8.3, and worth one sentence in the documented protocol so it does not read as a bug.
- **D5 probe (a).** `rewriteUpsertTargetAction` takes the advisory lock *after* deciding from the locked step row. "Advisory then (3) then step
  row" therefore needs a restructure (unconditional advisory, or (3) before the step row and advisory dropped to a re-check), not just
  inserting a lock. Expect C1/C3 here.
