## Context

- `OutputHistoryRepository.thinAndPurge(now, policy, maxAgeByTier)` (L1) runs on `ctx.withSystemContext` (privileged
  pool, one transaction). Step 1 age-purges per map entry joining `outputs o ... o.owner_id = u.id`; step 2 keeps the
  newest point per `(output_id, age_class, epoch bucket)`. A tier absent from the map is never age-purged.
- `users.tier` is `CHECK (tier IN ('free','beta','owner'))` (V88), so an "unknown tier" can only arise from a partial map.
- `OutputService.create` (and `PatchSetUndoService.restoreBoundOutputs`) set `outputs.owner_id = user.id`, the acting
  Editor grantee on a shared pipeline — so L1's join retains such history on the grantee's tier, not the pipeline
  owner's. The ticket specifies history → `pipelines.owner_id` → `users.tier`.
- Precedent: `ProductEventRollupService.tickAt(now)` is called from `PipelineSchedulerService.tick` through a nullable
  constructor param, zipped into the tick's future, and recovers+logs its own failures. `PipelineSchedulerActor` arms
  the next tick only after the previous tick's future completes.
- `PipelineRunGuardConfig.fromEnv()`: `sys.env.get(..).flatMap(_.toIntOption).getOrElse(Default)`, specs construct
  values directly.

## Goals / Non-Goals

**Goals:** D4 thinning + tier purge, hourly, from the existing tick; env config; failure isolation; privileged-pool proof.

**Non-Goals:** L6 payload caps, L3 read API, L8 baselines; a DB-persisted / cross-instance interval gate (the purge itself IS serialised by an advisory lock, no migration); any migration.

## Decisions

1. **Tier via the pipeline owner (minimal repo change).** Change step 1's `USING outputs o, users u WHERE
   h.output_id = o.id AND o.owner_id = u.id` to `USING pipelines p, users u WHERE h.pipeline_id = p.id AND
   p.owner_id = u.id`. `output_snapshot_history.pipeline_id` is written from the run's pipeline (L1) and the Output FK
   cascade keeps it consistent. Alternative (keep outputs.owner_id): rejected — contradicts the ticket and bills a
   shared pipeline's history to whoever happened to create the Output.
2. **Missing tier falls back to the strictest supplied cap.** Inside `thinAndPurge`, one age-purge DELETE per tier named
   in the map, plus one extra DELETE for every tier NOT named (`u.tier <> ALL (<named tiers>)`) at
   `strictest = maxAgeByTier.values.min`; an empty map keeps today's "no age purge". The code never enumerates all
   tiers, so a tier added later (or any value the `users.tier` CHECK once allows) fails closed by construction; a
   non-exhaustive Scala match only warns in this build, so totality is not relied on anywhere. Rationale: D4's purpose is bounding storage; failing toward the shortest cap
   bounds it, failing open retains forever. The service always passes a total map, so in production this is
   defence-in-depth for other callers (L6). L1's spec case "only for tiers present in the map" is updated to the new
   expectation (the owner row older than the fallback cap is now purged) and a dedicated fallback test added.
   Alternative (service-only totality, repo unchanged): rejected — leaves the fail-open primitive for later lanes.
3. **`OutputHistoryRetentionConfig`** (`services/pipelines/`), `fromEnv()` once in `Main`, defaults equal to D4 and
   to `HistoryThinningPolicy()`: `OUTPUT_HISTORY_MAX_AGE_DAYS_FREE`=30, `_BETA`=90, `_OWNER`=365;
   `OUTPUT_HISTORY_RECENT_WINDOW_HOURS`=24, `OUTPUT_HISTORY_RECENT_BUCKET_MINUTES`=5,
   `OUTPUT_HISTORY_MID_WINDOW_DAYS`=7, `OUTPUT_HISTORY_MID_BUCKET_MINUTES`=60, `OUTPUT_HISTORY_OLD_BUCKET_HOURS`=24,
   `OUTPUT_HISTORY_PURGE_INTERVAL_MINUTES`=60. Non-numeric or `< 1` → default per value; if the resulting recent window
   is not strictly shorter than the mid window, the whole thinning policy falls back to `HistoryThinningPolicy()` with
   a WARN. Exposes `policy: HistoryThinningPolicy`, `maxAgeByTier: Map[UserTier, Duration]` (the three known tiers; the repo fails closed for any other tier
   per Decision 2), `purgeInterval: Duration`. `fromEnv` takes an injectable `env: Map[String,String] = sys.env`
   so it is unit-testable without mutating the process environment.
4. **`OutputHistoryRetentionService(repo, config, clock)`**: `tick(): Future[Unit] = tickAt(clock.now())` and
   `purgeIfDue(now): Future[Option[Int]]`. Gate: an in-process `AtomicReference[Option[Instant]]` last-attempt mark;
   due iff none or `last + interval <= now`; the slot is claimed by CAS **before** calling the repo, so overlapping
   callers run at most one purge and a persistently failing purge retries once per interval, not every 30s tick.
   The repo call is wrapped (`Future.delegate`-style) so a synchronous throw becomes a failed future; failure →
   `log.error` and `None`; success logs the deleted count at INFO when > 0. Alternative (DB-persisted
   `last_purge_at` like `product_rollup_state`): needs a migration; the purge is idempotent and cheap, so N instances
   (prod max 2) each purging hourly is harmless. Restart re-purges on the first tick — also harmless.
5. **Scheduler wiring**: new last param `outputHistoryRetentionService: OutputHistoryRetentionService = null`; in
   `tick()`, `historyWork = if (svc != null) svc.purgeIfDue(now).map(_ => ()) else Future.successful(())`, zipped like
   `telemetryWork`, plus an outer `.recover` so even a bug in the service never fails the tick. `Main` constructs the
   service with the existing `outputHistoryRepo`, `OutputHistoryRetentionConfig.fromEnv()`, `SystemClock`.
6. **Tests** (embedded Postgres; existing L1 spec seeding helpers as the model):
   - `OutputHistoryRetentionServiceSpec` (FakeClock): `now` = a UTC midnight so the 24h/7d class edges coincide with
     hour/day bucket edges (no straddle). Seed a free and an owner Output with one point every 30 minutes across 40
     days (+ a few same-5-min duplicates within 24h). Expected survivors are a hand-derived literal description
     (counts per class + boundary instants listed explicitly), never produced by re-implementing the bucket SQL.
   - No-op: after tick 1, insert NEW thinnable points (e.g. two in one 5-min bucket), tick at +59 min → all remain;
     tick at +60 min → thinned. (Asserting "deleted 0" alone is vacuous: `thinAndPurge` is idempotent.)
   - Failure: a repo stub whose `thinAndPurge` returns a failed future, and one that throws synchronously; through
     `PipelineSchedulerService.tick()` with a due schedule candidate → tick succeeds, the candidate still fires, and the
     error is captured by a logback `ListAppender` (pattern already used in `ApiRoutesSpec`).
   - Shared pipeline: free Editor grantee's Output on an owner-tier pipeline, point at 40d → survives (red on L1 SQL).
   - Fallback: partial map `{Free -> 30d}`, owner-tier point at 40d → purged (red on L1 SQL).
   - Privileged pool (`OutputHistoryRetentionPrivilegedSpec`, RlsPrivilegedDmlSpec two-role setup): service purge
     deletes the expected rows; the same thin DELETE issued on the app pool (`helio_app_test`, no context) deletes 0
     and `SELECT rolbypassrls` for `current_role` on the app pool is false. Mutation: route the repo's purge through
     the app pool → red.
   - Config spec: defaults, per-value fallback, recent ≥ mid fallback, total tier map.

## Risks / Trade-offs

- The thinning DELETE scans the whole table hourly inside the tick (tick waits for it, like the telemetry precedent).
  Thinning bounds rows to roughly 288 + 144 + max-age-days per Output, so the scan stays small.
- Per-process gate: two instances may each attempt a purge in the same hour. The purge transaction begins with
  `pg_try_advisory_xact_lock(key "HEL1272" = 0x48454C31323732)`: it prevents two instances' concurrent multi-row
  DELETEs from deadlocking. Skip-not-wait: an instance that does not get the lock deletes nothing (DEBUG log) and, because
  its in-process gate slot is already claimed, retries one interval later; the lock holder is doing the same idempotent
  global pass. If the holder rolls back, nobody purges for up to one interval (bounded, no data risk).
- Changing the join means L1's privileged pool needs SELECT on `pipelines`/`users` (it already reads both elsewhere);
  the two-role spec proves it.

## Planner Notes

- Self-approved: Decision 1 (ticket text wins over L1 SQL), Decision 2 (fallback = strictest supplied cap), in-memory
  gate (no migration), env var names.
- Grepped at design time: `thinAndPurge` is referenced only by `OutputHistoryRepositorySpec`; no frontend/e2e touches
  history retention; `PipelineSchedulerService` constructor callers use named/defaulted params, so a new defaulted
  last param causes no churn.
