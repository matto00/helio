package com.helio.infrastructure.persistence.pipelines

import com.helio.infrastructure.persistence.DbContext
import com.helio.domain.model.PipelineId
import slick.jdbc.PostgresProfile.api._

import java.sql.Timestamp
import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** Persistence for the dataset-write auto-run debounce state (HEL-1093 design.md Decision 1) --
 *  `pipeline_auto_run_debounce` (V110) has one row per pipeline with a pending debounce window.
 *
 *  Every access is `DbContext.withSystemContext` (the privileged pool) -- both the write-time
 *  push-forward ([[upsertDebounce]]) and the tick-time claim/release ([[claimDue]]/
 *  [[releaseClaim]]) are privileged operations with no single request-bound user guaranteed to
 *  match the pipeline owner (design.md Context: the dataset writer and the pipeline owner can
 *  differ). RLS is still ENABLEd/FORCEd on the table at the schema level (V110) so a future
 *  caller reaching it over the app pool still degrades safely to "no rows visible".
 *
 *  [[claimDue]] is the exclusivity primitive this ticket's owner ruling requires (a genuinely
 *  atomic claim, not a TOCTOU-prone read-then-fire check like `PipelineSchedulerService`'s own
 *  `hasActiveRunInternal` overlap guard) -- a single `UPDATE ... RETURNING` statement, which
 *  Postgres serializes per matched row: two concurrent claims targeting the same pipeline_id
 *  serialize on that row, and the second one's `WHERE` no longer matches once the first commits. */
class PipelineAutoRunDebounceRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  /** Forward-only UPSERT (design.md Decision 2): pushes `fire_at` forward to
   *  `max(current fire_at, fireAt)` and resets `claimed_at` to `NULL` unconditionally. The
   *  `GREATEST` makes the push-forward monotonic even under out-of-order delivery across
   *  instances (two near-simultaneous writes computing slightly different `now` can never move
   *  `fire_at` backward). Resetting `claimed_at = NULL` on EVERY write (not just the first) is
   *  what makes a write arriving mid-fire correct -- see [[releaseClaim]]'s doc. */
  def upsertDebounce(pipelineId: PipelineId, fireAt: Instant): Future[Unit] = {
    val fireAtTs = Timestamp.from(fireAt)
    ctx.withSystemContext(
      sqlu"""INSERT INTO pipeline_auto_run_debounce (pipeline_id, fire_at, claimed_at)
             VALUES (${pipelineId.value}, $fireAtTs, NULL)
             ON CONFLICT (pipeline_id) DO UPDATE
               SET fire_at    = GREATEST(pipeline_auto_run_debounce.fire_at, EXCLUDED.fire_at),
                   claimed_at = NULL"""
    ).map(_ => ())
  }

  /** Atomically claims every row due to fire at or before `now` that is not already claimed (or
   *  whose claim is stale -- older than `staleClaimAfter`, a self-healing fallback for a claim
   *  whose process crashed before reaching [[releaseClaim]]). Returns each claimed pipeline's id
   *  paired with the EXACT `claimed_at` token this call wrote, which the caller must hand back to
   *  [[releaseClaim]] unchanged (compare-and-delete). */
  def claimDue(now: Instant, staleClaimAfter: Instant): Future[Vector[(PipelineId, Instant)]] = {
    val nowTs   = Timestamp.from(now)
    val staleTs = Timestamp.from(staleClaimAfter)
    ctx.withSystemContext(
      sql"""UPDATE pipeline_auto_run_debounce
            SET claimed_at = $nowTs
            WHERE fire_at <= $nowTs
              AND (claimed_at IS NULL OR claimed_at < $staleTs)
            RETURNING pipeline_id, claimed_at"""
        .as[(String, Timestamp)]
    ).map(_.map { case (pid, claimedAt) => (PipelineId(pid), claimedAt.toInstant) }.toVector)
  }

  /** Compare-and-delete on the exact `claimed_at` token [[claimDue]] returned -- NOT an
   *  unconditional `DELETE ... WHERE pipeline_id = ?`. If a new write arrives DURING this fire
   *  (between claim and release), [[upsertDebounce]]'s unconditional `claimed_at = NULL` reset
   *  means the row's `claimed_at` no longer matches `claimedAt` by the time this runs -- so this
   *  DELETE matches zero rows and the fresh pending write survives this tick's cleanup instead of
   *  being silently discarded (design.md Decision 3 step 4). Always called by the caller
   *  regardless of whether the claimed pipeline actually fired, was skipped for overlap, or was
   *  guard-rejected. */
  def releaseClaim(pipelineId: PipelineId, claimedAt: Instant): Future[Unit] = {
    val claimedTs = Timestamp.from(claimedAt)
    ctx.withSystemContext(
      sqlu"""DELETE FROM pipeline_auto_run_debounce WHERE pipeline_id = ${pipelineId.value} AND claimed_at = $claimedTs"""
    ).map(_ => ())
  }
}
