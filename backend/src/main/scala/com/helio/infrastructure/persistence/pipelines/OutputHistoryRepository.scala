package com.helio.infrastructure.persistence.pipelines

import com.helio.domain.model.UserTier
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.OutputRepository.jsObjectColumnType
import org.slf4j.LoggerFactory
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

  /** Thins history to the newest point per `(output, age class, bucket)` and purges points older
   *  than the tier max age of the owner of the point's PIPELINE (`pipelines.owner_id`, not
   *  `outputs.owner_id`, which is the acting Editor grantee on a shared pipeline). A tier absent
   *  from `maxAgeByTier` (including any tier unknown to this code) uses the strictest (shortest)
   *  supplied cap, so a partial map fails toward bounded storage; an empty map applies no age purge.
   *  One transaction; idempotent. Buckets are epoch-aligned and partitioned by age class, so a
   *  coarse bucket straddling a window boundary may briefly keep two points until a later pass. */
  def thinAndPurge(now: Instant, policy: HistoryThinningPolicy, maxAgeByTier: Map[UserTier, Duration]): Future[Int] = {
    val strictest = if (maxAgeByTier.isEmpty) None else Some(maxAgeByTier.values.min)
    val named = maxAgeByTier.toSeq.map { case (tier, maxAge) =>
      val tierName = UserTier.asString(tier)
      val cutoff   = Timestamp.from(now.minus(maxAge))
      sqlu"""DELETE FROM output_snapshot_history h
             USING pipelines p, users u
             WHERE h.pipeline_id = p.id AND p.owner_id = u.id AND u.tier = $tierName AND h.captured_at < $cutoff"""
    }
    // Any tier NOT named in the map (a tier added after this code, or a partial map) is purged at the
    // strictest supplied cap, so an unknown tier fails closed without this code enumerating tiers.
    val unnamed = strictest.toSeq.map { cap =>
      val namedCsv = maxAgeByTier.keys.map(UserTier.asString).mkString(",")
      val cutoff   = Timestamp.from(now.minus(cap))
      sqlu"""DELETE FROM output_snapshot_history h
             USING pipelines p, users u
             WHERE h.pipeline_id = p.id AND p.owner_id = u.id
               AND u.tier <> ALL (string_to_array($namedCsv, ',')) AND h.captured_at < $cutoff"""
    }
    val purgeByAge = DBIO.sequence(named ++ unnamed).map(_.sum)

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

    // Another instance already purging: skip rather than contend (two multi-row DELETEs can
    // deadlock); the next interval re-runs it. The xact lock releases at commit/rollback.
    val guarded = sql"SELECT pg_try_advisory_xact_lock($PurgeAdvisoryLockKey)".as[Boolean].head.flatMap {
      case true  => purgeByAge.flatMap(a => thin.map(_ + a))
      case false =>
        log.debug("Output history thin/purge skipped: another session holds the purge lock")
        DBIO.successful(0)
    }
    ctx.withSystemContext(guarded.transactionally)
  }
}

object OutputHistoryRepository {
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
