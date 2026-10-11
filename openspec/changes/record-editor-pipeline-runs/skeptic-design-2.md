## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 5a53d24b965a18e98729478b47949288cbb374d4. The planning artifacts and `Hel1492ReproSpec.scala` are uncommitted.

### What I verified (with evidence)

- **Spawn guard:** `READY ambient=/home/matt/Development/helio branch=bug/editor-pipeline-runs-unrecorded/HEL-1492`.
- **Root cause, re-derived from live code:**
  - `PipelineRunRepository.scala:129-159` keys the advisory lock on `user.id.value` (:149) and counts only pipelines the caller owns (:143). It returns `NotOwned` for a non-owner (:151).
  - `PipelineRunExecutor.scala:153` admits `Inserted | NotOwned`.
  - The following are all owner-filtered silent no-ops: `updateRunTerminal` (:172-193), `insertDryRun` (:221-225), `deleteOldRuns` (:247-251), `deleteOldDryRuns` (:273-277) and `PipelineRepository.updateLastRun` (:492-510).
  - The privileged `*Internal` siblings exist. `updateLastRunInternal` is at PipelineRepository:527-543. `withSystemContext` is the BYPASSRLS pool (`DbContext.scala`).
- **Admission path:** `submit` (PipelineRunService.scala:184-205) is the only route into `runPipeline`. Viewers get `Forbidden("Forbidden")` and non-grantees get NotFound.
  - Every `submit` caller passes a real user: routes, the scheduler (owner), `PipelineAutoRunDebounceFirer` (owner), `HookTriggerService` and `PipelineProposalService` (creator).
  - So D3's "every submit path passes `Some(user.id)`" is implementable.
- **Owner-side cap visibility:** V35 `pipeline_runs_owner` is `EXISTS (pipelines p WHERE p.owner_id = current_user_id)`. The owner's RLS-scoped count at :140-146 therefore sees rows an editor inserted on the owner's pipelines. "Editor in flight → owner 429" works with the owner path unchanged.
- **Lock-test feasibility:** a session-level `pg_advisory_lock(bigint)` held on a separate JDBC session shares its lock space with `pg_advisory_xact_lock(bigint)`. The D5 deterministic lock test is valid, and the "submitter-keyed" mutation turns it red.
- **Round-1 CRs, checked against artifacts and code (not just ticked off):**
  - CR1: the AC, the ADDED requirement and D2 now all say "authorized at admission, lifecycle writes always complete", and D2 states the stuck-slot rationale.
  - CR2: the MODIFIED `pipeline-assert-evaluation` delta header matches live `openspec/specs/pipeline-assert-evaluation/spec.md:85` exactly, both scenario names are preserved, and the capability is listed in the proposal.
  - CR3: I confirmed by grep that `NotOwned` appears in tests only in `PipelineRunRepositorySpec` and `PipelineRunGuardIntegrationSpec`. The enumerated lines are correct: PipelineRunServiceSpec:521-545, GuardIntegrationSpec:370-385 and RepositorySpec:626-638.
  - CR4: the deterministic lock test is present in D5 and task 5.3.
  - CR5: both write-back branches (Executor:301-304 and :306-308) are in D5/5.3a, and the stuck-slot risk is listed.
- **Migration number:** after `git fetch`, the newest migration on `origin/main` is V123, so V124 is free.
- **Spec consistency:** the live `pipeline-run-execution` "Non-dry run persists a pipeline_runs record" requirement (:252) already requires keep-10 retention and terminal rows. The ADDED requirement extends that to editors and contradicts nothing. `pipeline-sharing` :88 ("editor can trigger runs") is unaffected.

### Verdict: REFUTE

The design is sound, and the five round-1 issues are genuinely fixed. One required revision remains. It is the same class of defect round 1's CR5 caught, and the same class this ticket exists to fix: a silent owner-only no-op hidden behind `recoverWith`.

### Change Requests

1. **The editor retention writes have no task or test, so the AC "Run-history retention (keep 10) applies to editor runs" is untraceable. The mutation that breaks it passes every planned test.**
   - **The two sites:**
     - Real runs: `PipelineRunExecutor.scala:154-156`. preExec calls `deleteOldRuns(pipelineId, user, keepN = 10).recoverWith{...}`. This call is in the executor, not in the terminal writers.
     - Dry runs: `PipelineRunTerminalWrites.scala:127`, `deleteOldDryRuns(pipelineId, user)`, also under `recoverWith`.
   - **What is missing:** D2 says retention uses `*Internal`, but the tasks do not cover either site.
     - Task 3.1 only says "editor runs use 2.1".
     - Task 3.2 names only `PipelineRunTerminalWrites`/`PipelineRunSucceededWrites`.
     - No 5.x test asserts retention for an editor.
   - **Consequence:** if either editor branch stays on the owner-scoped method, it silently no-ops. Nothing fails, and a pipeline run only by an editor grows its run history without bound.
   - **Required revisions:**
     - (a) Name `PipelineRunExecutor` preExec retention (:154-156) explicitly in task 3.1 as switching to `deleteOldRunsInternal` for editor runs.
     - (b) Add a test. An editor submits 11 real runs and exactly 10 non-dry rows remain. An editor submits 11 successful dry runs and exactly 10 `dry_run` rows remain.
     - (c) Prove both are failable by the "editor branch left on owner-scoped `deleteOldRuns`/`deleteOldDryRuns`" mutation, consistent with C5.

### Non-blocking notes (for the executor)

- **Inverting GuardIntegrationSpec:370-385 needs a real in-flight run.** Its "Fill the OWNER's own cap first" (`await(service.submit(pid, isDry = false, owner))`) does not fill the cap. `submit` resolves only after the run is terminal, so at `maxConcurrent = 1` the slot is already free.
  - Flipping the assertion to `429` alone would be red for the wrong reason, and it stays red after the fix.
  - Use the existing gated-backend fixture (the `Promise` gate at :150/:303) to hold the owner's run `queued`, or seed a `queued` row directly.
  - Do the same for "editor in flight → owner's next submit 429".
- **Stale doc comments missing from D5's list:**
  - `PipelineRunTerminalWrites.scala:91-100` (`persistAssertions` doc: "insertRun/insertDryRun already silently no-op for ... an editor grantee").
  - PipelineRunServiceSpec :553-556 and :578-579 ("owner-only no-ops for a non-owner run").
  - Update these with the NotOwned comments.
- **Attribution test list:** AC D3 names the hook token user, but D5 tests only owner/editor/scheduled. A hook-path attribution assertion is cheap and covers the remaining AC clause.
- **SparkJobSubmitter:** `SparkJobSubmitter.scala:69` (`insertRunInternal`, dormant) will write NULL `triggered_by_user_id`. That is still an unacknowledged exception to "every newly written row records `triggered_by_user_id`". Thread `None` with a comment, or note it.
- **`NotOwned` retirement:** after D1, the owner path's `pipelineOwnedAction` can still fail, for example if the pipeline is deleted mid-submit. Whatever replaces `NotOwned` must map to a non-admitting `Left` (NotFound/Forbidden), never `Right`. Task 2.3 implies this; check it in review.
- **Behaviour change to expect:** editor runs now have `completed_at IS NULL` rows. The scheduler overlap guard (`hasActiveRunInternal`) and the hook duplicate-collapse (`findActiveRunInternal`) will start seeing in-flight editor runs. This is correct, but it is new: a hook may now collapse into an editor's run.
