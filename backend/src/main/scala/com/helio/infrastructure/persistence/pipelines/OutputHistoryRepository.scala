package com.helio.infrastructure.persistence.pipelines

import com.helio.domain.model.UserTier
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.OutputRepository.jsObjectColumnType
import slick.jdbc.PostgresProfile.api._
import spray.json.JsObject

import java.sql.Timestamp
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
    summary: JsObject
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
    summary: JsObject
)

/** Age-dependent bucket widths for thinning (owner ruling D4): within `recentWindow` keep at most
 *  one point per `recentBucket`, within `midWindow` one per `midBucket`, older one per `oldBucket`.
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

  private val table = TableQuery[HistoryTable]

  private def toPoint(r: HistoryRow): OutputHistoryPoint =
    OutputHistoryPoint(r._1, r._2, r._3, r._4, r._5, r._6, r._7, r._8, r._9, r._10)

  /** Composable (never runs itself) so it can share the node snapshot replace's transaction.
   *  A lifted batch insert: `summary` carries user-controlled column names and string values and
   *  must only ever be a bound parameter, never interpolated SQL text. */
  def insertAction(entries: Seq[OutputHistoryInsert]): DBIO[Unit] =
    if (entries.isEmpty) DBIO.successful(())
    else
      (table ++= entries.map(e =>
        (UUID.randomUUID(), e.outputId, e.pipelineId, e.nodeStepId, e.rootId, e.runId, e.triggerSource, e.capturedAt, e.rowCount, e.summary)
      )).map(_ => ())

  /** Newest first; `id DESC` breaks `captured_at` ties deterministically. */
  def listRecent(outputId: String, limit: Int): Future[Vector[OutputHistoryPoint]] =
    ctx.withSystemContext(
      table.filter(_.outputId === outputId).sortBy(r => (r.capturedAt.desc, r.id.desc)).take(limit).result
    ).map(_.map(toPoint).toVector)

  /** The latest point with `captured_at <= at` (the baseline lookup). */
  def nearestAtOrBefore(outputId: String, at: Instant): Future[Option[OutputHistoryPoint]] =
    ctx.withSystemContext(
      table.filter(r => r.outputId === outputId && r.capturedAt <= at).sortBy(r => (r.capturedAt.desc, r.id.desc)).take(1).result
    ).map(_.headOption.map(toPoint))

  /** The oldest point's `captured_at` (the "comparison available from" date). */
  def earliest(outputId: String): Future[Option[Instant]] =
    ctx.withSystemContext(table.filter(_.outputId === outputId).map(_.capturedAt).min.result)

  /** Thins history to the newest point per `(output, age class, bucket)` and purges points older
   *  than the owner's tier max age (a tier absent from `maxAgeByTier` is never age-purged).
   *  One transaction; idempotent. Buckets are epoch-aligned and partitioned by age class, so a
   *  coarse bucket straddling a window boundary may briefly keep two points until a later pass. */
  def thinAndPurge(now: Instant, policy: HistoryThinningPolicy, maxAgeByTier: Map[UserTier, Duration]): Future[Int] = {
    val purgeByAge = DBIO.sequence(maxAgeByTier.toSeq.map { case (tier, maxAge) =>
      val tierName = UserTier.asString(tier)
      val cutoff   = Timestamp.from(now.minus(maxAge))
      sqlu"""DELETE FROM output_snapshot_history h
             USING outputs o, users u
             WHERE h.output_id = o.id AND o.owner_id = u.id AND u.tier = $tierName AND h.captured_at < $cutoff"""
    }).map(_.sum)

    val nowTs        = Timestamp.from(now)
    val recentSecs   = policy.recentWindow.getSeconds
    val midSecs      = policy.midWindow.getSeconds
    val recentBucket = policy.recentBucket.getSeconds
    val midBucket    = policy.midBucket.getSeconds
    val oldBucket    = policy.oldBucket.getSeconds
    val thin =
      sqlu"""DELETE FROM output_snapshot_history WHERE id IN (
               SELECT id FROM (
                 SELECT id, row_number() OVER (
                   PARTITION BY output_id, age_class, floor(epoch / bucket_secs)
                   ORDER BY captured_at DESC, id DESC) AS rn
                 FROM (
                   SELECT id, output_id, captured_at,
                          extract(epoch FROM captured_at) AS epoch,
                          CASE WHEN extract(epoch FROM ($nowTs::timestamptz - captured_at)) < $recentSecs THEN 0
                               WHEN extract(epoch FROM ($nowTs::timestamptz - captured_at)) < $midSecs THEN 1
                               ELSE 2 END AS age_class,
                          CASE WHEN extract(epoch FROM ($nowTs::timestamptz - captured_at)) < $recentSecs THEN $recentBucket
                               WHEN extract(epoch FROM ($nowTs::timestamptz - captured_at)) < $midSecs THEN $midBucket
                               ELSE $oldBucket END AS bucket_secs
                   FROM output_snapshot_history
                 ) classed
               ) ranked WHERE rn > 1)"""

    ctx.withSystemContext((purgeByAge.flatMap(a => thin.map(_ + a))).transactionally)
  }
}

object OutputHistoryRepository {
  type HistoryRow = (UUID, String, String, Option[String], Option[String], Option[String], String, Instant, Int, JsObject)

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

    def * = (id, outputId, pipelineId, nodeStepId, rootId, runId, triggerSource, capturedAt, rowCount, summary)
  }
}
