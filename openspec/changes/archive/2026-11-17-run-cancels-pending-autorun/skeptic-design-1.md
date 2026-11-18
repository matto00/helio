## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD ff667dd571ce2f86ba3298c2f742f1f08c138c22 (planning artifacts untracked in the worktree).

### What I verified (with evidence)

- **Upsert happens after the dataset write commits.** `DataSourceService.appendRows/appendFormRow/replaceRows/patchRow`
  (DataSourceService.scala:844, 877, 899, 927) call `triggerAutoRunAwaited` only inside the repo future's
  `Some(Right(...))` branch; `deleteRow` (:953) calls the fire-and-forget variant inside the completed `.map`. Only
  `AutoRunTriggerService.evaluateAndSchedule` (:78) calls `upsertDebounce`. Pipeline write-backs
  (`applyPendingWriteBacks` -> `dataSourceRepo.applyWriteBacks`, PipelineRunExecutor.scala:473-485) never arm an
  auto-run, so there is no self-arming loop. Holds.
- **Source rows are read only after the planned snapshot point.** `runPipeline` resolves `roots` before `executeRun`,
  but a `DatasetSource` carries no rows (DataSource.scala:217-226); rows come from `dataSourceRepo.readDatasetRows`
  inside `InProcessPipelineEngine.loadRowsWithStats` (:684-689), which is reached only from `backend.execute` in
  `runAdmitted` (PipelineRunExecutor.scala:256-261). The snapshot on the `Inserted` arm (:173-178) comes before that.
  Under READ COMMITTED each later statement sees every commit before it. The ordering argument holds.
- **ABA.** The row is deleted and recreated (`releaseClaim`, `rearmAfterGuardRejection` exhaust), so a per-row counter
  would be unsafe. A non-cycling sequence makes equality-compare safe. Holds.
- **Firer interaction.** `processAutoRunClaim` (PipelineAutoRunDebounceFirer.scala) unclaims while
  `hasActiveRunInternal` (`completed_at IS NULL`, PipelineRunRepository.scala:622) is true. `releaseClaim`, `unclaim` and
  `rearmAfterGuardRejection` all compare on `claimed_at`, so a row deleted by the cancel makes them match zero rows,
  which gives `Superseded` and debug-level logging only. Holds.
- **Failure path / terminal win.** `afterTerminalWin` (PipelineRunTerminalWrites.scala:65) runs its body only when
  `won`. A blocked run goes through `onBlockedRun`, and a write-back failure goes through `onWriteBackFailure`
  (PipelineRunExecutor.scala:448-462). Neither reaches `onUnblockedRunSuccess`. D4 is correct.
- **Is owner escalation needed?** No. The ticket explicitly leaves the failure-path decision to the design. Cancelling at
  success instead of at start makes no difference that users can see while the run is active, because HEL-1504's
  unclaim already holds the pending auto-run until the run's `completed_at` is set. The intent is "don't re-run for a
  write the run already read", and success-time compare-and-delete delivers it. This is within design authority.
- **Migration number.** The highest migration on base is V140; V144 is free.
- **Grant convention.** V38 grants sequences through `ALTER DEFAULT PRIVILEGES`. V113 (:11-12) and V115 (:17) state the
  binding repo rule instead: use explicit GRANTs to `helio_privileged`, because "production has hit grant-only
  incidents that superuser-run tests cannot observe". V128 (:81) applies it to a sequence (`GRANT USAGE, SELECT ON
  SEQUENCE ... TO helio_privileged`). `PipelineRootWriteGrantsSpec` + `ProductTelemetryDbHarness` (migrates as a
  NOSUPERUSER NOBYPASSRLS role) is the existing harness for proving grants from the migration chain.
- **e2e workaround.** There are 3 call sites (hel1277 spec:122, :130, :276) plus the helper (historySeed.ts:84). Each
  call comes after an awaited `putRows`, and an awaited `runPipeline` follows it. D6's description is accurate.

### Verdict: REFUTE

### Change Requests

1. **Missing explicit sequence grant, which would break silently in prod (design D1, tasks 1.1).** `upsertDebounce` runs
   on the privileged pool (`SET ROLE helio_privileged`). After this change it calls `nextval(...)` in both the SET and
   the column DEFAULT, so `helio_privileged` needs `USAGE` on the new sequence. The design relies implicitly on V38's
   default privileges. The repo rule (V113/V115/V128) is an explicit GRANT. The failure mode is the worst kind: an
   upsert error is caught and logged by `evaluateOne`/`DataSourceService`'s `.recover`, so every dataset write would keep
   returning 200 while **no auto-run is ever armed again in prod**. Local and CI tests run as superuser and stay
   green. Required revisions:
   - D1 and task 1.1 state that V144 adds `GRANT USAGE, SELECT ON SEQUENCE pipeline_auto_run_debounce_write_seq TO
     helio_privileged`.
   - Add a test task that proves it from the migration chain alone: `has_sequence_privilege('helio_privileged',
     'pipeline_auto_run_debounce_write_seq', 'USAGE')` through `ProductTelemetryDbHarness`, following the
     `PipelineRootWriteGrantsSpec` pattern. Make it red first by removing the GRANT (a recorded mutation).
2. **The spec delta's "if, and only if" contradicts the design's own Risks section (specs/.../spec.md, first
   paragraph).** The requirement says the run SHALL cancel "if, and only if, every write the pending auto-run represents
   was recorded before that run began reading its source rows". The design deliberately does **not** cancel in two
   cases where every write was recorded before reading began:
   - (a) a write committed before the snapshot whose upsert lands after it. design.md Risks, bullet 1, acknowledges
     this.
   - (b) a write armed between the snapshot and the start of the read (`retainF` listing, PipelineRunExecutor.scala:252-255).

   An evaluator testing against the SHALL would find a spec divergence. Reword it as a one-way guarantee tied to the
   real boundary. For example: "SHALL cancel only writes whose auto-run was armed before the run's admission snapshot.
   A write armed after that snapshot SHALL keep its own auto-run. A write armed before it but not yet visible MAY still
   produce a redundant auto-run." Then define "admission snapshot" once.
3. **State the start boundary against the ticket's literal line (design D2).** The ticket says "A write that lands after
   the run started must still schedule its own auto-run". The run "starts" at the `Inserted` admission commit (the
   `queued` row, `startAt`). The snapshot comes after admission and retention (`deleteOldRuns`, :174-178). So a write
   armed in that window is cancelled, even though it landed after the run started. It is read, so cancelling it is
   correct on the ticket's own rationale, but the design must say so explicitly. Do one of these:
   - (i) Move the snapshot to just before the admission call. This complies with the ticket literally at no cost, and a
     `CapExceeded`/`NotAuthorized` result just discards it. It still stays outside the admission transaction, so
     HEL-1734 is untouched.
   - (ii) Keep the current placement and add a sentence to D2 that this is a deliberate reading of "started" as
     "began reading", with the reason.
4. **Specify that the cancel is part of the awaited success chain (design D3, task 2.2).** `onUnblockedRunSuccess`
   publishes `succeeded` and returns the HTTP response only after `writesChain()`'s `chain` completes (the for-comprehension
   plus `deletedRecovery.recover(... siblings = ...)`). D3 says only "inside the `afterTerminalWin` body" and does not say
   whether the cancel future is sequenced into `chain` and the recovery `siblings`. If it is not, it is effectively
   fire-and-forget. Test 4.1 ("row gone" after the run returns) and the e2e removal (D6) would then depend on timing,
   which is the same class of flake HEL-1729 was. Require the cancel to be sequenced in `chain` before `succeeded` is
   published, with its WARN-and-continue `recover` inside it.

### Non-blocking notes

- **Add a Risks bullet for the post-terminal window.** The cancel runs after the `succeeded` terminal write sets
  `completed_at`. A firer tick that lands between that commit and the cancel DELETE sees no active run and fires the
  (already due) row. The cancel then deletes the claimed row, and the firer's `releaseClaim` is a no-op. The outcome is
  one redundant auto-run, which is today's behaviour, so it is conservative. The window is milliseconds against a 30 s
  tick, so it is not worth a lock. Just document it, so that a test asserting "no auto-run after a tick" holds the tick
  until after the run returns.
- **Implementation choice in task 1.2.** Using `EXCLUDED.write_generation` in the conflict SET (the DEFAULT already
  drew a fresh value) and calling `nextval` in the SET are both unique. Either is fine; pick one and test that the
  generation changes on the conflict path.
- **Test-plan item 4 also needs** a check that `rearmAfterGuardRejection`'s Superseded/Exhausted paths leave
  `write_generation` untouched. The tasks already say this; make sure the test actually asserts the column value.
