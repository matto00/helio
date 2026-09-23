## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Scheduler's existing double-fire guard is genuinely non-atomic**, matching design.md's Context
  claim: read `backend/src/main/scala/com/helio/services/pipelines/PipelineSchedulerService.scala`
  lines 40-111. `fireIfNotOverlapping` combines an in-process `mutable.Set` (`reserve`/`release`,
  same-instance only) with a plain `runRepo.hasActiveRunInternal` read, then a separate `fire()`
  call — the read and the fire are not one atomic statement, exactly as design.md's Context
  describes. Confirmed correct.

- **`PipelineRunService.submit`'s current `TriggerSource` object only has `Manual`/`Scheduled`/
  `External`** (lines 1610-1614) — `AutoRun` genuinely needs to be added (task 1.2), and the
  default arg `triggerSource: String = TriggerSource.Manual` (line 220) confirms every existing
  call site is unaffected by the new value, matching the design's claim.

- **`pipeline_runs_trigger_source_check`'s exact name and current values** confirmed in
  `V63__pipeline_run_trigger_source.sql`: `CHECK (trigger_source IN ('manual', 'scheduled',
  'external'))`. Design.md Decision 1's `DROP CONSTRAINT`/`ADD CONSTRAINT` SQL matches this
  constraint name and value set exactly. `V109__pipeline_run_rate_window.sql` is confirmed as the
  latest migration — `V110` is genuinely the next free version.

- **`DbContext.withUserContext`/`withSystemContext`** confirmed at
  `infrastructure/persistence/DbContext.scala` lines 34-64: `withSystemContext` runs on the
  privileged (`BYPASSRLS`) pool, `withUserContext` sets the RLS GUC on the app pool — matches
  design's description exactly.

- **The V62 vs. V109 RLS-pattern contrast is accurate.** `V62__pipeline_schedules.sql`'s indirect-
  owner policy (`EXISTS (... p.owner_id = current_setting('app.current_user_id')::uuid)`) is
  byte-for-byte the pattern design.md Decision 1 proposes for `pipeline_auto_run_debounce`.
  `V109__pipeline_run_rate_window.sql`'s direct-owner policy (`user_id =
  current_setting(...)::uuid`) confirms the contrast design.md draws against it (why V109's shape
  is wrong for this new table).

- **`PipelineRunService.submit`'s guard-repo calls do set `app.current_user_id` correctly for a
  synthetic owner `AuthenticatedUser`.** `PipelineRunGuardRepository.incrementRateIfUnderLimit`
  (lines 46-63) calls `ctx.withUserContext(userId.value)(action)` where `userId` is exactly the
  `user.id` `executeRun` was called with — for the scheduler's `fire()` (and, by the same
  mechanism, the new auto-run fire path), that `user` is `AuthenticatedUser(pipeline.ownerId, ...)`,
  so the rate-limit/concurrency-cap RLS context is correctly the pipeline owner with no bespoke
  handling needed, exactly as design.md Context claims.

- **The atomic claim (`UPDATE ... RETURNING`, Decision 3 step 1) is genuinely exclusive** under
  standard Postgres row-level locking semantics: two concurrent `UPDATE`s targeting the same row
  serialize; the second transaction's `WHERE` clause is re-evaluated against the post-commit row
  once unblocked, and since the first commit already set a fresh `claimed_at`, the second's `WHERE
  (claimed_at IS NULL OR claimed_at < staleClaimAfter)` no longer matches. This is a correct
  design, unlike the scheduler's own `hasActiveRunInternal` TOCTOU check.

- **The compare-and-delete release (Decision 3 step 4) correctly avoids the described race.** If a
  new write resets `claimed_at = NULL` (and pushes `fire_at` forward) between claim and release,
  the release's `WHERE pipeline_id = ? AND claimed_at = ?` (naming the OLD claim token) matches
  zero rows, so the fresh pending write survives the tick's cleanup. Verified this is exactly what
  Decision 2's "unconditional `claimed_at = NULL` on every write" is for. Correct.

- **The non-cascade claim (write-back writes never reach `DataSourceService`'s five methods) is
  mechanically true, not just asserted.** Traced `PipelineRunService.runPipeline` →
  `DataSourceRepository.applyWriteBacks` (line 1244) → `writeExistingDatasetAction` (repository,
  line 412) → `appendRowsAction`/`replaceRowsAction` (the private DBIO bodies, repository-internal)
  — this path never touches `DataSourceService.appendRows`/`appendFormRow`/`replaceRows`/
  `patchRow`/`deleteRow` at all. The five service methods are the only place the new
  `triggerAutoRun` hook is wired in (task 2.2), so write-back writes structurally cannot trigger a
  further auto-run. Confirmed correct.

- **`pipeline_roots` schema supports the reverse lookup** (`PipelineRootRepository.scala` lines
  182-190: `data_source_id` column exists on `pipeline_roots`), so
  `listPipelineIdsForDataSourceInternal` (task 1.4) is straightforwardly implementable as a filter
  + distinct over the existing table, following the same `listInternal`/`withSystemContext`
  convention already used elsewhere in this file.

- **`SCHEDULER_TICK_INTERVAL_SECONDS` default is 30s** (`application.conf` lines 139-140),
  confirming Decision 5's ~35s worst-case latency arithmetic (5s debounce + 30s tick).

### Verdict: REFUTE

### Change Requests

1. **The CostInput-gathering "verbatim" reuse plan (Decision 2 / task 1.5) is unsound for the
   auto-run trigger's actual calling context — this needs to be resolved before implementation, not
   discovered by the executor.**

   `PipelineService.analyze`'s existing CostInput-gathering (`PipelineService.scala` lines 951-957)
   resolves every pipeline root via `dataSourceRepo.findByIdOwned(dsId, user)` —
   `DataSourceRepository.findByIdOwned` (lines 155-160) is **strict-ownership-only**
   (`r.ownerId === ownerUuid`), no sharing/grantee consideration. In `analyze`, this is an
   accepted, already-documented degradation ("a root `findByIdOwned` can't see (e.g. a shared
   viewer) yields `None`... `unclassified-source`" — HEL-1092 D7 comment at line 949), but it is
   *bounded*: `analyze`'s `user` has already passed `pipelineRepo.findByIdShared(pipelineId,
   Some(user))` (line 920), i.e. is at minimum an owner/editor/viewer of the pipeline itself.

   The new auto-run trigger has no such bound. Design.md's own Context section states the premise
   plainly: *"a pipeline's owner and a downstream dataset write's author can differ"* — the writer
   triggering `triggerAutoRun` may have **zero** relationship to the downstream pipeline at all
   (not owner, not grantee — only required to own the one `DataSourceId` they wrote to, per each
   `DataSourceService` method's own `findByIdOwned` gate on the write itself). Reusing `analyze`'s
   `user`-scoped gathering "verbatim" against the writer, for a pipeline with more than one root,
   means every co-root not owned by the writer resolves to `None` → `unclassified-source` →
   `autoRunnable = false` — silently and incorrectly **denying** an otherwise-eligible pipeline's
   auto-run on every single write, for as long as that ownership split exists. This is a real,
   fail-closed-but-wrong functional defect against AC #2 ("Only pipelines whose... verdict...
   is true... actually run" implies pipelines that *are* eligible must actually run — an
   ACL-artifact false denial breaks that).

   This is not merely inferable — it's an **internal inconsistency already visible in the task
   breakdown itself**: task 2.1's own signature, `AutoRunTriggerService.triggerAutoRun(dataSourceId,
   now)`, carries **no `AuthenticatedUser`/user parameter at all**. There is no principal in scope
   at that call site to pass into a "verbatim" reuse of `analyze`'s `findByIdOwned`-based logic in
   the first place — the design does not say what gets passed, because nothing coherent can be.

   The fix already exists as a precedent in this same codebase: `PipelineRunService.
   resolveAllRootDataSourcesInternal` (`PipelineRunService.scala` lines 297-302) resolves every
   root via `dataSourceRepo.findByIdInternal` (privileged, `withSystemContext`) rather than
   `findByIdOwned` — exactly the "ACL was already confirmed at a higher layer" pattern this new
   caller needs, since the writer's ACL is irrelevant to the downstream pipeline's own roots. The
   extracted shared helper (task 1.5) needs to be parameterized (or have a privileged variant) so
   the auto-run path resolves roots via `findByIdInternal`, not the writer's `findByIdOwned` — and
   `lastRunRowCount`'s source (`summary` from `findSummaryByIdShared`, also `user`-scoped in
   `analyze`) needs the same treatment (a privileged/internal equivalent, or resolved once the
   pipeline owner is already known — e.g. after `pipelineRepo.findByIdInternal(pipelineId)`, mirror
   `PipelineSchedulerService.fire`'s existing pattern of resolving the owner via
   `pipelineRepo.findByIdInternal` before doing anything ACL-sensitive).

   **Required revision:** design.md Decision 2 / task 1.5 must specify that the auto-run path's
   `CostInput` gathering resolves roots (and `lastRunRowCount`) via privileged/internal lookups,
   not `user`-scoped `findByIdOwned`/`findSummaryByIdShared` — either by threading a genuine
   privileged variant through the shared helper, or by fetching the pipeline
   (`findByIdInternal`) first and reusing its already-established `ownerId` context. This also
   needs at least one test added to tasks.md section 3 explicitly covering a **multi-root pipeline
   where a co-root is owned by someone other than the writer** — none of 3.1/3.2/3.3/3.6 as
   currently scoped require more than one root, so this defect could ship and pass every listed
   test.

### Non-blocking notes

- Decision 3's `staleClaimAfter = now - 5 minutes` self-heal window and Decision 5's accepted
  ~35s worst-case latency are both explicit, owner-ruled trade-offs with clear reasoning; no
  objection.
- Tasks 3.1-3.9 are otherwise well-targeted (each names a specific probe/mutation and what it
  proves), and 3.4's cross-instance test design (two service instances sharing one DB) is the
  right shape to actually exercise `claimDue`'s atomicity rather than merely asserting it.
