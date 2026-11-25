## Skeptic Report — design gate (round 4, skeptic-design-4.md)

I reviewed at HEAD 7292f77d60ff9f46cf3fc94ce83c1f110b92139f. The change dir is untracked, so I read the artifacts on disk: ticket.md, proposal.md, design.md, tasks.md, both spec deltas, and skeptic-design-1/2/3.md. I checked them against the live backend source, the base specs and `docs/live-draft-preview.md` (Order O*). This was a read-only review. I started no servers and ran no sbt.

### Round-3 change requests: status

- **CR1 (the gated group's dependency on the fold): resolved, and correct against the code.**
  - What the artifacts now say:
    - D1 and task 1.2: the gated group starts once the fold has SETTLED (success or failure) AND W6 has returned. It runs only when W6 won, and applies W3 only for nodes whose write committed.
    - D3 now states correctly that HEL-1594 D2 gates the NODE FOLD on `terminalWritten`.
  - Checked against `LateFinisherDeleteAfterWonSpec.scala:76-106`:
    - `beforeNodeFold` waits on `written`, then deletes the pipeline, so the first node guard trips `Missing` and the fold fails.
    - Because the group starts on fold settle after a won W6, the binary write still starts and `entered` completes.
    - `nothingWritten` still holds, because no node committed and so no W3 is applied.
  - The other HEL-1564 cases also still work:
    - The narrowness control (`:110-123`) and the "post-fold binary write fails after won" case (`:56-69`) wait on `written` and `done`, which D1 still satisfies.
    - D1b (`:127-141`) is the one circular case. It is listed for re-expression in task 3.7a, and the re-expression is sound: after the answer, the chain has settled, so "`binaryEntered` never completed" is a deterministic absence check.
  - Fixtures are unaffected. `writeTerminal` returns `true` when no run repository is wired (`PipelineRunTerminalWrites.scala:59`), so route fixtures without a run repo still run the gated writes.
- **CR2 (split the write-back scenarios): resolved.**
  - The reaper delta now has two scenarios: "Reap lands after the early open-check but before the write-back" (nothing written) and "Reap lands after the write-back committed but before the run's own terminal write" (the write-back rows remain; no W3/W4/W5/W10; no event; 409).
  - The second scenario correctly says nothing about node snapshots. Under D9, nodes committed while the run was open may remain.
  - Task 3.1 includes the "write-back committed before the reap" case.
- **CR3 (the whole reap predicate inside the CASE): resolved.**
  - D4 and task 2.3 now put `completed_at IS NULL AND status <> 'dry_run' AND (<heartbeat/legacy stale>)` inside the `CASE WHEN`, with `ELSE false`.
  - I checked whether this costs an index:
    - The live statement (`PipelineRunRepository.scala:391-430`) has no indexable open-run predicate.
    - The only `pipeline_runs` indexes are `pipeline_id` (V24) and `(pipeline_id, started_at DESC)` (V136).
    - So the reaper already scans the table, and moving the predicate into the CASE costs no index.
  - The try-lock is volatile and its arguments are per-row, so plan-time folding cannot hoist it out of the CASE.
- **Round-3 notes: all folded in.**
  - `:338` is re-seeded older than 24 h, with an owner-call control (task 3.6).
  - D9 names `lateFinisher`'s WARN as AC2's one clear line.
  - Task 3.1 names the `AlertEvaluationService` fixture wiring.
  - The delta example now reads "refused by the run guard".

### What I verified (with evidence)

- **D5 trip routing.**
  - `RunNoLongerOpen` extends `RuntimeException`, not `IllegalStateException` (`PipelineRunRepository.scala:757`). So `applyWriteBacks`'s `recover { case e: IllegalStateException }` (`DataSourceRepository.scala:584-587`) does not swallow it.
  - Without the new first arm, `unblockedChain`'s `NonFatal` arm (`PipelineRunExecutor.scala:456-462`) would record `failed`.
  - With the re-raise, `:419`'s `recoverWith` maps the trip to `lateFinisher`. D5 is necessary and sufficient.
- **W1 shape.**
  - `applyWriteBacks` is one `withUserContext(owner)` `.transactionally` DBIO, so a guard composed first really is first in the transaction.
  - `pipeline_runs.id` is `TEXT` (V24), so `hashtext(runId)` and the reaper's `hashtext(id)` hash the same value.
  - RLS: `pipeline_runs_owner` (V35:77-84) admits the pipeline owner through an `EXISTS` on `pipelines`, which is the write-back's context.
  - `Hel1503EditorRunGapsSpec.scala` exists for C3.
- **D4 deadlock argument, re-derived.**
  - The write-back waits only for the key, and holds nothing while it waits.
  - The reaper can hold the exclusive key while it waits on another run's node-guard row lock, or on a pipeline row lock in the `last_run` CTE. Neither of those holders ever waits on a key, and nothing else ever takes the key. So there is no cycle.
  - Two concurrent reapers still finalize a run exactly once: the second one's try-lock fails while the first holds the key, so it skips the run. That matches "Reaping is safe across instances".
- **D8 retention.**
  - The prune predicate (`PipelineRunRepository.scala:500-526`) has no `completed_at`.
  - The only test files calling `deleteOldRuns` are `PipelineRunRepositorySpec` (lines 171, 189, 199, 211, 344, 362) and `PipelineRunOrderTiebreakSpec`.
  - `:181` (40 runs, all kept) still passes unchanged. The five listed tests are the affected ones.
- **AC6.** `services/alerts/` has no HTTP, email, webhook or Resend reference. A skipped alert write needs no behaviour decision.
- **Deltas.**
  - Both MODIFIED requirement titles match the base specs exactly.
  - No base scenario is dropped. The added scenarios are the ones listed above, plus "An in-flight run is never pruned".

### Verdict: CONFIRM

The design is sound and implementable. Every round-1 to round-3 change request is resolved, and each resolution is correct against the code. The two items below are wording fixes the executor should make during implementation. They are not design defects.

### Non-blocking notes

1. **The archived reaper spec will contradict itself unless one more requirement is modified.**
   - Base `pipeline-run-reaper` "Stale non-terminal runs are reaped as failed" (spec.md:19-24) says every tick SHALL mark as failed EVERY stale non-terminal run.
   - The delta's new clause says a reap SHALL NOT finalize a run whose write-back transaction is open.
   - Fix: add a MODIFIED delta for that requirement, carrying the exception ("... except a run whose write-back transaction is open, which is reaped on a later tick").
   - The proposal's "Modified Capabilities" line for `pipeline-run-reaper` should mention it too.
2. **The Risks bullet "reaped one tick later (at most ~30 s)" is inaccurate.**
   - The reaper skips the run for as long as the write-back transaction stays open.
   - If an instance stalls INSIDE that transaction (with its connection still held), the run is not reaped until the transaction ends.
   - This is still strictly better than the HEL-1518 node guard, where the reaper statement waits outright. Restate the bound as "for as long as the write-back transaction is open".
3. **Task 2.1 should state the state mapping**: no row maps to `RunNoLongerOpen(Missing)`, and a terminal row maps to `RunNoLongerOpen(Terminal)`. `lateFinisher`'s 404/409 split depends on it, and task 3.2's 409 assertion and a pipeline-deleted variant would exercise both.
4. **Task 3.3 needs a way to park W1 inside its transaction after the guard.** The natural seam is the guard parameter from task 2.2: pass `guard andThen DBIO.from(release.future)`. Then wait on `pg_stat_activity` (C2), not on a sleep.
