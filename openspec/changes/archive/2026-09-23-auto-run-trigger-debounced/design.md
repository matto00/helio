## Context

Confirmed against the live tree at Planning time (see `premise-validation.md`, persisted evidence):

- `PipelineRunService.submit` is the single choke point every trigger (manual, `HookTriggerService`
  external hook, `PipelineSchedulerService` scheduled) already goes through; it applies HEL-505's
  rate limit (all submissions) and concurrency cap (real runs), and its guard-repo calls already
  set `app.current_user_id` via `ctx.withUserContext` — no bespoke RLS handling is needed by a new
  caller as long as it passes a correctly-constructed `AuthenticatedUser`.
- `PipelineCostEstimator.estimate(CostInput): CostVerdict` (HEL-1092) is a pure, IO-free classifier;
  its own header comment names this ticket as the consumer keying on `autoRunnable`. `CostInput` is
  gathered by IO in `PipelineService.analyze` today — this change factors the *assembly* of that
  IO-gathered data into a shared helper rather than duplicating it (Decision 2a), but **not** its
  root-resolution strategy: `analyze`'s root resolution (`dataSourceRepo.findByIdOwned(dsId,
  user)`, `PipelineService.scala` line ~949) is strict-ownership-only against the REQUESTING user,
  which is safe there because `analyze`'s caller has already passed a pipeline-level ACL check
  (`findByIdShared`). The auto-run trigger's caller (the dataset writer) has no such relationship to
  the downstream pipeline in general (see the next bullet) — reusing `findByIdOwned` against the
  writer would silently misclassify any co-root the writer doesn't own as `unclassified-source`,
  wrongly denying an otherwise-eligible pipeline (caught at the design gate, round 1 — see
  `skeptic-design-1.md`). Decision 2a resolves this: the shared helper takes root resolution as a
  parameter, and the auto-run call site supplies a privileged one.
- `PipelineSchedulerService.fire` constructs `AuthenticatedUser(pipeline.ownerId, source =
  AuditSource.System, tokenId = None)` for a scheduled run (HEL-1108's precedent: "Scheduled runs
  count against the pipeline owner"). This change mirrors that pattern exactly for auto-run.
- **The scheduler's existing double-fire guard across instances is NOT exclusive.** Read closely
  (not assumed) per the owner's explicit instruction: `PipelineSchedulerService.fireIfNotOverlapping`
  combines an in-process `mutable.Set` (`reserve`/`release`, same-instance only) with a
  `runRepo.hasActiveRunInternal` read-then-fire check. The read and the fire are NOT in one atomic
  statement — two instances could both read "no active run" before either has inserted one, and
  both proceed to fire. This is an accepted, documented imperfection for *schedule* ticks (worst
  case: two scheduled runs instead of one, self-limited by HEL-505's own guards — a nuisance, not a
  correctness bug for that use case). The owner's ruling for THIS ticket sets a stricter bar
  ("must not both fire the same row"), so this change does **not** mirror
  `hasActiveRunInternal`-style TOCTOU checking for its own claim; see Decision 2.
- `pipeline_schedules` (V62) is the established RLS pattern for a table that is (a) keyed by
  `pipeline_id`, (b) has no `owner_id` column of its own, and (c) is read/written exclusively by a
  privileged background job with no request-bound user: FORCE RLS with an indirect-owner policy
  joining to `pipelines.owner_id`, and all access via `DbContext.withSystemContext` (the privileged,
  BYPASSRLS pool — the only RLS-bypass mechanism in this codebase; see `DbContext`'s own header).
  This is a closer precedent for the new debounce table than `pipeline_run_rate_window` (V109, which
  is genuinely keyed by the *acting user* and accessed via `withUserContext`), because the debounce
  table's writer (whoever submits the dataset write) is not always the pipeline's owner: a pipeline
  root's data source is only required to be owned by whoever added that root (`PipelineService
  .addRoot`'s `findByIdOwned(dsId, user)` check uses the ADDING user, an editor grantee of the
  pipeline in the general case), so a pipeline's owner and a downstream dataset write's author can
  differ. The debounce table therefore follows V62's pattern, not V109's.
- `upsertsource` (write-back) pipeline steps write through `DataSourceRepository.applyWriteBacks`
  directly — a distinct code path from every `DataSourceService` row-mutation method
  (`appendRows`/`appendFormRow`/`replaceRows`/`patchRow`/`deleteRow`). This change hooks the
  auto-run trigger into those five `DataSourceService` methods only, which mechanically (not by a
  special-case check) excludes pipeline-internal write-back writes from ever triggering a further
  auto-run — confirming the proposal's non-goal without needing extra guard logic.
- `pipeline_runs.trigger_source` has a `CHECK (trigger_source IN ('manual', 'scheduled',
  'external'))` constraint (V63) — a new `'auto-run'` value requires widening this constraint, not
  just adding a Scala enum value.
- The existing scheduler actor ticks every 30s by default (`helio.scheduler.tick-interval-seconds`,
  `SCHEDULER_TICK_INTERVAL_SECONDS` env override, `PipelineSchedulerActor`/`Main.scala`). The
  owner's ruling is to fire debounced auto-runs from this SAME tick rather than add a second timer.

## Goals / Non-Goals

**Goals:**
- Ten rapid dataset writes (ten increments in two seconds) produce exactly one auto-run per
  eligible downstream pipeline — provably, including under two concurrently-running backend
  instances (matches prod's up-to-2-Cloud-Run-instance topology).
- The debounce claim is genuinely exclusive across instances (not a best-effort/TOCTOU check) —
  the owner's explicit bar for this ticket, stricter than the existing scheduler's own guard.
- Every auto-run enters through `PipelineRunService.submit`, attributed to the pipeline owner,
  subject to HEL-505's rate limit/concurrency cap and HEL-1092's cheapness verdict identically to
  every other trigger.
- A denied or guard-rejected auto-run is never silently dropped (logged, at minimum).
- No new REST endpoint; no dedicated new timer/poller.

**Non-Goals:**
- Cascading auto-runs (a pipeline's own write-back triggering a further downstream auto-run) — see
  Context above; mechanically excluded by the hook point chosen, not a separate feature.
- The "Run to update" manual UI affordance for a denied pipeline (HEL-1096).
- Reducing perceived latency below the existing scheduler tick interval — the owner explicitly
  declined a dedicated faster sweeper for this ticket. This change measures and reports the
  resulting worst-case write-to-run latency in the PR body instead of building a faster path.

## Decisions

### Decision 1 — Debounce table: `pipeline_auto_run_debounce`, keyed by `pipeline_id`, V62-pattern RLS

New migration `V110__pipeline_auto_run_debounce.sql`:

```sql
CREATE TABLE pipeline_auto_run_debounce (
    pipeline_id  TEXT PRIMARY KEY REFERENCES pipelines(id) ON DELETE CASCADE,
    fire_at      TIMESTAMPTZ NOT NULL,
    claimed_at   TIMESTAMPTZ
);

ALTER TABLE pipeline_auto_run_debounce ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_auto_run_debounce FORCE ROW LEVEL SECURITY;

CREATE POLICY pipeline_auto_run_debounce_owner ON pipeline_auto_run_debounce
  USING (
    EXISTS (
      SELECT 1 FROM pipelines p
      WHERE p.id = pipeline_auto_run_debounce.pipeline_id
        AND p.owner_id = current_setting('app.current_user_id')::uuid
    )
  );

ALTER TABLE pipeline_runs DROP CONSTRAINT pipeline_runs_trigger_source_check;
ALTER TABLE pipeline_runs ADD CONSTRAINT pipeline_runs_trigger_source_check
  CHECK (trigger_source IN ('manual', 'scheduled', 'external', 'auto-run'));
```

One row per pipeline that currently has a pending debounce window; the row is deleted once
consumed (Decision 2). All access to this table is via `DbContext.withSystemContext` (privileged
pool) — both the write-time push-forward (Decision 2) and the tick-time claim (Decision 3) are
privileged operations with no single request-bound user that's guaranteed to match the pipeline
owner (see Context: the writing user and the pipeline owner can differ). RLS is still enabled/
FORCEd on the table (never skip RLS at the schema level, per V62's own rationale) so that if a
future caller ever reaches this table over the app pool, it still degrades safely to "no rows
visible" rather than an open table.

**Alternative considered:** keying by `(pipeline_id, user_id)` like `pipeline_run_rate_window`.
Rejected — the debounce state is inherently per-*pipeline* (a single downstream reader has exactly
one pending "next fire" time regardless of which user's write pushed it there); a user-keyed table
would need a separate row per writer, with no clear way to derive "the" pending fire time for a
pipeline read by multiple users' writes.

### Decision 2 — Write-time: unconditional forward-only UPSERT, never a synchronous run

`DataSourceService`'s five row-mutation methods (`appendRows`, `appendFormRow`, `replaceRows`,
`patchRow`, `deleteRow`) each already call a private `audit(...)` helper after a successful write;
this change adds a sibling private helper, `triggerAutoRun(dataSourceId, now)`, called alongside it
— fire-and-forget, wrapped in a `.recover` that logs and swallows any exception, exactly like
`audit`'s own optional/no-op convention (a debounce-scheduling failure must never fail the write
itself).

`triggerAutoRun`:
1. Privileged lookup (new `PipelineRootRepository.listPipelineIdsForDataSourceInternal
   (dataSourceId): Future[Vector[PipelineId]]`) — every pipeline whose root references this data
   source. This is privileged (not scoped to the writing user) because the eligible pipelines may
   be owned by a different user than the writer (Context, above) — the writer already proved
   ownership of the *source* at the call site above this helper; the auto-run itself is entirely
   pipeline-owner-attributed and doesn't depend on the writer's own access to the pipeline.
2. For each pipeline: gather `PipelineCostEstimator.CostInput` via the shared helper (Decision 2a,
   privileged variant) and call `PipelineCostEstimator.estimate`.
   - `autoRunnable = false` → log at INFO with the pipeline id, data source id, and every
     `CostReason` code/detail (never silently dropped — this satisfies the ticket's "denial reason
     available" requirement; HEL-1096 owns surfacing it in UI, not this ticket).
   - `autoRunnable = true` → UPSERT the debounce row:
     ```sql
     INSERT INTO pipeline_auto_run_debounce (pipeline_id, fire_at, claimed_at)
     VALUES (?, ?, NULL)
     ON CONFLICT (pipeline_id) DO UPDATE
       SET fire_at    = GREATEST(pipeline_auto_run_debounce.fire_at, EXCLUDED.fire_at),
           claimed_at = NULL
     ```
     `fire_at = now + DATASET_WRITE_DEBOUNCE_SECONDS` (new config, default `5`, comfortably above
     the AC's 2-second burst so timing jitter in a real multi-instance test never straddles two
     windows). `GREATEST(...)` makes the push-forward monotonic even under out-of-order delivery
     across instances (two near-simultaneous writes computing slightly different `now` can never
     move `fire_at` backward). Setting `claimed_at = NULL` unconditionally on every write is what
     makes debounce vs. "in-flight run" interact correctly — see the second bullet of Decision 3.

No run is ever submitted synchronously from the write path — this UPSERT is the entire effect of a
dataset write on auto-run.

### Decision 2a — Shared `CostInput` gathering, with root resolution supplied by the caller (design-gate round 1 fix)

**Round 1 of the design-soundness gate REFUTEd the original "reuse `analyze`'s gathering logic
verbatim" plan** (`skeptic-design-1.md`): `analyze`'s root resolution is ACL-scoped to the
*requesting* user (`findByIdOwned`), which is only safe there because that user has already passed
a pipeline-level ACL check. The auto-run trigger's caller is the dataset *writer*, who — per the
Context section above — is only guaranteed to own the one `DataSourceId` they wrote to, not
necessarily any other root on a multi-root pipeline reading it. Reusing `findByIdOwned` against the
writer would resolve every co-root the writer doesn't own to `None` → `unclassified-source` →
`autoRunnable = false`, silently denying an otherwise-eligible pipeline on every write. This was
also visible as an internal inconsistency: `AutoRunTriggerService.triggerAutoRun(dataSourceId,
now)` (task 2.1) carries no `AuthenticatedUser` parameter at all, so there was no principal in
scope to even attempt the "verbatim" reuse.

**Fix:** extract only the ACL-*insensitive* part of `analyze`'s gathering (root-list resolution via
`pipelineRepo.listRootDataSourceIdsInternal`, per-root dataset-row-count lookup via
`dataSourceRepo.countDatasetRows`, and `CostInput` assembly) into a shared helper,
`PipelineCostInputGathering.gather(pipelineId, enabledSteps, lastRunRowCount, resolveRoot:
DataSourceId => Future[Option[DataSource]])`. The ACL-*sensitive* piece — how a single root's
`DataSourceId` resolves to a `DataSource` — is supplied by the caller as `resolveRoot`, exactly
like `PipelineRunService.resolveAllRootDataSourcesInternal` already does for the run-execution path
(same file family, `dataSourceRepo.findByIdInternal`, privileged):
- `PipelineService.analyze` passes `dsId => dataSourceRepo.findByIdOwned(dsId, user)` — unchanged
  behavior, byte-for-byte the same resolution `analyze` already performs today.
- `AutoRunTriggerService` passes `dsId => dataSourceRepo.findByIdInternal(dsId)` — privileged,
  matching `resolveAllRootDataSourcesInternal`'s own established precedent for "the caller's ACL is
  irrelevant; the pipeline's own definition is what's being resolved."

`lastRunRowCount` needs the identical treatment: `analyze` already has it in scope from
`findSummaryByIdShared`'s ACL-scoped `summary`, but the auto-run path has no such summary. A new
privileged scalar accessor, `PipelineRepository.findLastRunRowCountInternal(pipelineId):
Future[Option[Long]]` (a one-column `withSystemContext` `SELECT`, mirroring this file's existing
small internal-getter convention), supplies it for the `AutoRunTriggerService` call site.

`PipelineService.hasSourceUrl` (a private per-kind config helper `analyze` already uses) moves into
the same shared object so both call sites use one implementation, not two.

This directly satisfies AC #2 ("only pipelines whose verdict is true actually run" — implying an
eligible pipeline must not be wrongly denied by an ACL artifact) for every multi-root pipeline
regardless of which user owns which root.

### Decision 3 — Fire-time: the existing scheduler tick claims and fires due rows, atomically

`PipelineSchedulerService.tick()` gains one more piece of work, run alongside (not instead of) its
existing schedule-candidate processing — same tick, same 30s cadence (`SCHEDULER_TICK_INTERVAL_
SECONDS`), no new actor/timer:

1. **Atomic claim** (new `PipelineAutoRunDebounceRepository.claimDue(now, staleClaimAfter):
   Future[Vector[(PipelineId, Instant)]]`, privileged pool):
   ```sql
   UPDATE pipeline_auto_run_debounce
   SET claimed_at = ?now
   WHERE fire_at <= ?now
     AND (claimed_at IS NULL OR claimed_at < ?staleClaimAfter)
   RETURNING pipeline_id, claimed_at
   ```
   A single `UPDATE ... RETURNING` is genuinely exclusive under Postgres row-level locking: two
   concurrent claims targeting the same row serialize on that row, and the second one's `WHERE`
   clause no longer matches once the first commits (`claimed_at` is now set and recent) — this is
   what actually satisfies the owner's "must not both fire the same row" bar, unlike the scheduler's
   own `hasActiveRunInternal` check (Context, above). `staleClaimAfter = now - 5 minutes` is a
   self-healing fallback: if a prior claim never reached the delete in step 3 below (e.g. the
   process crashed mid-fire) AND no further write ever reset it, this lets it be re-claimed instead
   of being stuck forever — chosen generously above any realistic `submit()` duration.
   **Alternative considered:** `pg_advisory_xact_lock(hashtext(...))`, the pattern
   `PipelineRunRepository.insertRunIfUnderConcurrencyCap` already uses for HEL-505's concurrency
   cap. Rejected for this specific job — the tick needs to claim a *batch* of due rows in one pass,
   and a single `UPDATE ... RETURNING` does that in one statement, where an advisory lock would need
   one lock acquisition per candidate row inside the loop for no additional correctness benefit
   here.
2. For each claimed `(pipelineId, claimedAt)`: same overlap consideration the scheduler already
   applies to scheduled fires — check `runRepo.hasActiveRunInternal(pipelineId)` and skip firing
   (still proceed to step 3's release) if a run is already active, mirroring
   `fireIfNotOverlapping`'s own accepted imperfection for this narrower purpose (avoiding two
   simultaneous runs of the same pipeline is a UX/waste concern, not this ticket's exclusivity
   requirement, which Decision 3's claim already satisfies independently).
3. If firing: resolve `pipeline.ownerId`, build `AuthenticatedUser(pipeline.ownerId, source =
   AuditSource.System, tokenId = None)` exactly like `PipelineSchedulerService.fire`, and call
   `pipelineRunService.submit(pipelineId, isDry = false, owner, triggerSource =
   TriggerSource.AutoRun)`. A guard rejection (`ServiceError.TooManyRequests`) is logged (not
   silently dropped) — `submit`'s own failure recording already covers an execution-time failure,
   mirroring `PipelineSchedulerService.fire`'s existing `.transform` guard against an unexpected
   exception.
4. **Release the claim** (new `PipelineAutoRunDebounceRepository.releaseClaim(pipelineId,
   claimedAt): Future[Unit]`, privileged pool), *always* (whether fired, skipped for overlap, or
   guard-rejected), via compare-and-delete on the exact `claimed_at` token this claim returned:
   ```sql
   DELETE FROM pipeline_auto_run_debounce WHERE pipeline_id = ? AND claimed_at = ?
   ```
   This is the detail that makes Decision 2's `claimed_at = NULL`-on-every-write correct: if a new
   write arrives *during* this fire (between claim and release) it resets `claimed_at` to `NULL`
   and pushes `fire_at` forward — the compare-and-delete above then matches zero rows (the
   `claimed_at` it's looking for no longer matches), so the fresh pending write is never silently
   discarded by this tick's cleanup. An unconditional `DELETE ... WHERE pipeline_id = ?` would have
   this exact bug.

`TriggerSource.AutoRun = "auto-run"` is added to the existing `TriggerSource` object (mirrors
`Manual`/`Scheduled`/`External`).

### Decision 4 — `PipelineSchedulerService`'s cleanup convention is reused, not duplicated

HEL-505 already piggybacked a bounded `pipeline_run_rate_window` cleanup sweep onto this same tick
(`pipelineRunGuardRepo.cleanupOldWindows()`, nullable-optional wiring). The new debounce-claim work
above (step 1-4) is itself the "cleanup" for this table — a completed/skipped fire always deletes
its own row (step 4) — so no separate sweep is needed; a claimed-but-never-released row is instead
handled by the `staleClaimAfter` fallback inside the claim itself (Decision 3, step 1).

### Decision 5 — Latency is measured and reported, not engineered around

Per the owner's ruling, no dedicated faster sweeper is added. Worst-case write-to-run latency is
`DATASET_WRITE_DEBOUNCE_SECONDS` (quiet window, default 5s) + up to `SCHEDULER_TICK_INTERVAL_
SECONDS` (default 30s) ≈ 35s from the last write to the run actually being submitted. The executor
measures this end-to-end in the delivered integration test and reports the real observed number in
the PR body (not just the theoretical bound above) — if that number makes auto-run feel broken for
an interactive counter, the ruling is to raise it as a follow-up rather than silently shrinking the
global scheduler tick interval (which would speed up every scheduled pipeline too, an unrelated
and unreviewed side effect).

## Risks / Trade-offs

- **Perceived latency.** Up to ~35s worst case (Decision 5) between the last write and the run
  actually starting. Accepted per the owner's explicit ruling; flagged as a candidate follow-up
  once measured.
- **A crashed claim with no further write is stuck for `staleClaimAfter` (5 min), not forever** —
  self-heals via the claim's own stale-reclaim fallback (Decision 3); an operator would only notice
  a single missed auto-run window in the crash-with-no-subsequent-write case, not a permanently
  broken pipeline.
- **Overlap-skip can silently miss a write's effect** if a same-pipeline run is already active when
  a debounce fires (Decision 3, step 2) — an accepted, pre-existing imperfection this change
  mirrors from the scheduler rather than introduces; a subsequent write (if any) will still debounce
  and fire normally once the active run completes.
- **A pipeline whose owner has hit the rate limit or concurrency cap at fire time drops that
  specific auto-run** (logged, not retried) — matches every other trigger's existing behavior under
  HEL-505; no new retry mechanism is introduced by this ticket.
