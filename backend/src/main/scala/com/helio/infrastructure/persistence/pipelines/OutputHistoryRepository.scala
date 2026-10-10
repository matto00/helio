package com.helio.infrastructure.persistence.pipelines

import com.helio.domain.history.HistoryBaselineLimits
import com.helio.domain.model.UserTier
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.OutputRepository.jsObjectColumnType
import org.slf4j.LoggerFactory
import slick.jdbc.PostgresProfile.api._
import spray.json.JsObject

import java.time.{Duration, Instant}
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** One history point to insert: everything but the generated `id`. */
final case class OutputHistoryInsert(
    outputId: String,
    pipelineId: String,
    nodeStepId: Option[String],
    rootId: Option[String],
    runId: Option[String],
    triggerSource: String,
    capturedAt: Instant,
    rowCount: Int,
    summary: JsObject,
    /** HEL-1276: the node payload this point links to; only set for an Output that opted in. */
    payloadId: Option[UUID] = None
)

final case class OutputHistoryPoint(
    id: UUID,
    outputId: String,
    pipelineId: String,
    nodeStepId: Option[String],
    rootId: Option[String],
    runId: Option[String],
    triggerSource: String,
    capturedAt: Instant,
    rowCount: Int,
    summary: JsObject,
    payloadId: Option[UUID] = None
)

/** Age-dependent bucket widths for thinning (owner ruling D4): within `recentWindow` keep at most
 *  one point per `recentBucket`, within `midWindow` one per `midBucket`, older one per `oldBucket`.
 *  These widths apply only to points older than an Output's newest 101 (HEL-1285; see `thinPass`).
 *  Env loading and scheduling belong to the retention leaf, not here. */
final case class HistoryThinningPolicy(
    recentWindow: Duration = Duration.ofHours(24),
    recentBucket: Duration = Duration.ofMinutes(5),
    midWindow: Duration = Duration.ofDays(7),
    midBucket: Duration = Duration.ofHours(1),
    oldBucket: Duration = Duration.ofDays(1)
)

/** Persistence for `output_snapshot_history` (V115). Every method runs on the privileged pool:
 *  callers authorize the Output first (`OutputRepository.findById`), exactly as for `node_snapshots`
 *  reads, and the write path runs inside a node's snapshot transaction. */
class OutputHistoryRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  import OutputHistoryRepository._

  private val log   = LoggerFactory.getLogger(getClass)
  private val table = TableQuery[HistoryTable]

  private def toPoint(r: HistoryRow): OutputHistoryPoint =
    OutputHistoryPoint(r._1, r._2, r._3, r._4, r._5, r._6, r._7, r._8, r._9, r._10, r._11)

  /** Composable (never runs itself) so it can share the node snapshot replace's transaction.
   *  A lifted batch insert: `summary` carries user-controlled column names and string values and
   *  must only ever be a bound parameter, never interpolated SQL text. */
  def insertAction(entries: Seq[OutputHistoryInsert]): DBIO[Unit] =
    if (entries.isEmpty) DBIO.successful(())
    else
      (table ++= entries.map(e =>
        (UUID.randomUUID(), e.outputId, e.pipelineId, e.nodeStepId, e.rootId, e.runId, e.triggerSource, e.capturedAt, e.rowCount, e.summary, e.payloadId)
      )).map(_ => ())

  /** Newest first; `id DESC` breaks `captured_at` ties deterministically. */
  def listRecent(outputId: String, limit: Int): Future[Vector[OutputHistoryPoint]] =
    ctx.withSystemContext(
      table.filter(_.outputId === outputId).sortBy(r => (r.capturedAt.desc, r.id.desc)).take(limit).result
    ).map(_.map(toPoint).toVector)

  /** One point, scoped to its Output (a point id from another Output never resolves). */
  def findPoint(outputId: String, pointId: UUID): Future[Option[OutputHistoryPoint]] =
    ctx.withSystemContext(table.filter(r => r.id === pointId && r.outputId === outputId).result).map(_.headOption.map(toPoint))

  /** The latest point with `captured_at <= at` (the baseline lookup). */
  def nearestAtOrBefore(outputId: String, at: Instant): Future[Option[OutputHistoryPoint]] =
    ctx.withSystemContext(
      table.filter(r => r.outputId === outputId && r.capturedAt <= at).sortBy(r => (r.capturedAt.desc, r.id.desc)).take(1).result
    ).map(_.headOption.map(toPoint))

  /** The oldest point's `captured_at` (the "comparison available from" date). */
  def earliest(outputId: String): Future[Option[Instant]] =
    ctx.withSystemContext(table.filter(_.outputId === outputId).map(_.capturedAt).min.result)

  /** One bounded history pass (HEL-1435): up to `limits.maxBatches` batches, each over whole Outputs (keyset
   *  over `outputs.id`, starting after `startAfter`), in its OWN transaction that first takes the try-only
   *  purge lock. A batch first deletes, for its Outputs, the points older than the tier max age of the owner
   *  of the point's PIPELINE (`pipelines.owner_id`, not `outputs.owner_id`, which is the acting Editor grantee
   *  on a shared pipeline; a tier absent from `maxAgeByTier` uses the strictest supplied cap; an empty map
   *  applies no age purge), then thins the batch to the newest point per `(output, age class, bucket)`.
   *
   *  HEL-1285 baseline guarantee: thinning NEVER deletes an Output's newest `protectedNewest` points
   *  (default [[HistoryBaselineLimits.ProtectedNewestPoints]] = 101, ordered `captured_at DESC, id DESC`
   *  exactly like `listRecent`), so an alert `previous`/`rolling_avg` baseline and a `previous_run` compare
   *  always see the literal most recent runs. Bucketing applies only to the older points, each bucket keeping
   *  its newest unprotected point. The tier max-age purge is unconditional: a protected point older than the
   *  cap is still deleted. Buckets are epoch-aligned and partitioned by age class, so a coarse bucket
   *  straddling a window boundary may briefly keep two points until a later pass.
   *
   *  Every window is per Output, so batching by whole Outputs leaves each Output exactly what one statement
   *  over all Outputs would at the same `now`. Batches committed before a lock-held skip stay committed.
   *  Returns [[HistoryPassOutcome]]; idempotent. */
  def thinPass(
      now: Instant,
      policy: HistoryThinningPolicy,
      maxAgeByTier: Map[UserTier, Duration],
      limits: ThinBatchLimits,
      startAfter: Option[String] = None,
      protectedNewest: Int = HistoryBaselineLimits.ProtectedNewestPoints
  ): Future[HistoryPassOutcome] = {
    def loop(cursor: Option[String], ran: Int, deleted: Int): Future[HistoryPassOutcome] =
      // maxBatches >= 1, so a cursor exists by the time the budget is spent (the "" is unreachable).
      if (ran >= limits.maxBatches) Future.successful(HistoryPassOutcome.MoreWork(deleted, cursor.getOrElse("")))
      else
        thinBatch(now, policy, maxAgeByTier, limits, cursor, protectedNewest).flatMap {
          case BatchResult.Busy => Future.successful(HistoryPassOutcome.LockHeld(deleted, cursor))
          case BatchResult.Last(d) => Future.successful(HistoryPassOutcome.Completed(deleted + d))
          case BatchResult.Next(d, lastId) => loop(Some(lastId), ran + 1, deleted + d)
        }
    loop(startAfter, 0, 0)
  }

  /** TEST-ONLY one-call form: drains a whole cycle with `limits` (every pass back to back); a lock-held skip anywhere
   *  is `LockBusy`. Production never calls it: the scheduler runs [[thinPass]] one bounded pass per tick. */
  def thinAndPurge(
      now: Instant,
      policy: HistoryThinningPolicy,
      maxAgeByTier: Map[UserTier, Duration],
      protectedNewest: Int = HistoryBaselineLimits.ProtectedNewestPoints,
      limits: ThinBatchLimits = ThinBatchLimits.Defaults
  ): Future[RetentionPassOutcome] = {
    def drain(cursor: Option[String], deleted: Int): Future[RetentionPassOutcome] =
      thinPass(now, policy, maxAgeByTier, limits, cursor, protectedNewest).flatMap {
        case HistoryPassOutcome.Completed(d)    => Future.successful(RetentionPassOutcome.Purged(deleted + d))
        case HistoryPassOutcome.MoreWork(d, at) => drain(Some(at), deleted + d)
        case HistoryPassOutcome.LockHeld(_, _)  => Future.successful(RetentionPassOutcome.LockBusy)
      }
    drain(None, 0)
  }

  /** One batch in one transaction. Another instance already purging (or a run's payload trim holding the lock
   *  shared): skip rather than contend (two multi-row DELETEs can deadlock); the service retries a lock-held
   *  skip after a short window. The xact lock releases at commit/rollback. */
  private def thinBatch(
      now: Instant,
      policy: HistoryThinningPolicy,
      maxAgeByTier: Map[UserTier, Duration],
      limits: ThinBatchLimits,
      after: Option[String],
      protectedNewest: Int
  ): Future[BatchResult] = {
    val work: DBIO[BatchResult] =
      HistoryThinBatching.candidates(after, limits.batchOutputs).flatMap { ids =>
        if (ids.isEmpty) DBIO.successful(BatchResult.Last(0))
        else
          HistoryThinBatching.admit(ids, limits.batchRows).flatMap { case (batch, stoppedEarly) =>
            for {
              aged   <- HistoryThinBatching.ageDelete(now, maxAgeByTier, batch)
              thinned <- HistoryThinBatching.thin(now, policy, protectedNewest, batch)
            } yield {
              val more = stoppedEarly || ids.size >= limits.batchOutputs
              if (more) BatchResult.Next(aged + thinned, batch.last) else BatchResult.Last(aged + thinned)
            }
          }
      }
    val guarded = sql"SELECT pg_try_advisory_xact_lock($PurgeAdvisoryLockKey)".as[Boolean].head.flatMap {
      case true => work
      case false =>
        log.debug("Output history thin/purge skipped: another session holds the purge lock")
        DBIO.successful(BatchResult.Busy)
    }
    ctx.withSystemContext(guarded.transactionally)
  }
}

object OutputHistoryRepository {
  /** Result of one batch transaction (top-level in the companion so type tests have no outer reference). */
  private sealed trait BatchResult
  private object BatchResult {
    case object Busy                                    extends BatchResult
    final case class Last(deleted: Int)                 extends BatchResult
    final case class Next(deleted: Int, lastId: String) extends BatchResult
  }

  /** Namespace for the purge's `pg_try_advisory_xact_lock` (ASCII "HEL1272"); no other lock uses it. */
  private[persistence] val PurgeAdvisoryLockKey: Long = 0x48454C31323732L

  type HistoryRow = (UUID, String, String, Option[String], Option[String], Option[String], String, Instant, Int, JsObject, Option[UUID])

  class HistoryTable(tag: Tag) extends Table[HistoryRow](tag, "output_snapshot_history") {
    def id            = column[UUID]("id", O.PrimaryKey)
    def outputId      = column[String]("output_id")
    def pipelineId    = column[String]("pipeline_id")
    def nodeStepId    = column[Option[String]]("node_step_id")
    def rootId        = column[Option[String]]("root_id")
    def runId         = column[Option[String]]("run_id")
    def triggerSource = column[String]("trigger_source")
    def capturedAt    = column[Instant]("captured_at")
    def rowCount      = column[Int]("row_count")
    def summary       = column[JsObject]("summary")
    def payloadId     = column[Option[UUID]]("payload_id")

    def * = (id, outputId, pipelineId, nodeStepId, rootId, runId, triggerSource, capturedAt, rowCount, summary, payloadId)
  }
}
