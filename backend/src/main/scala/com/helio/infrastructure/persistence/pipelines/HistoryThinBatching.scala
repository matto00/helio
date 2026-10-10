package com.helio.infrastructure.persistence.pipelines

import com.helio.domain.model.UserTier
import slick.jdbc.PostgresProfile.api._
import slick.jdbc.SetParameter

import java.sql.{Timestamp, Types}
import java.time.{Duration, Instant}
import scala.concurrent.ExecutionContext

/** HEL-1435: sizes of the bounded history thin. A batch is a run of whole Outputs (keyset over `outputs.id`)
 *  of at most `batchOutputs` Outputs and at most `batchRows` history rows (the first Output of a batch is
 *  always admitted, so a single Output larger than `batchRows` forms a batch by itself); a pass runs at most
 *  `maxBatches` batches. */
final case class ThinBatchLimits(batchOutputs: Int, batchRows: Int, maxBatches: Int)

object ThinBatchLimits {
  val DefaultBatchOutputs: Int = 500
  val DefaultBatchRows: Int    = 25000
  val DefaultMaxBatches: Int   = 20
  val Defaults: ThinBatchLimits = ThinBatchLimits(DefaultBatchOutputs, DefaultBatchRows, DefaultMaxBatches)
}

/** Result of one bounded history pass. `deleted` counts the points removed (age purge + thin) by the batches
 *  the pass committed; those stay committed whatever the variant. */
sealed trait HistoryPassOutcome

object HistoryPassOutcome {
  /** Every Output was thinned this cycle. */
  final case class Completed(deleted: Int) extends HistoryPassOutcome
  /** The batch budget ran out with Outputs remaining; resume with `startAfter = Some(resumeAfter)`. */
  final case class MoreWork(deleted: Int, resumeAfter: String) extends HistoryPassOutcome
  /** The retention advisory lock was held when a batch tried it; the batch ran nothing. `resumeAfter` is where
   *  the retry resumes (None = from the start of the cycle). */
  final case class LockHeld(deleted: Int, resumeAfter: Option[String]) extends HistoryPassOutcome
}

/** The SQL of one thin batch (HEL-1435). Every statement is restricted to the batch's whole Outputs, both on
 *  the DELETE target and in the ranking scan, so none can Seq Scan `output_snapshot_history`. */
private[pipelines] object HistoryThinBatching {

  private implicit val setTextArray: SetParameter[Seq[String]] = SetParameter { (v, pp) =>
    pp.setObject(pp.ps.getConnection.createArrayOf("text", v.toArray[AnyRef]), Types.ARRAY)
  }
  private implicit val setTimestampArray: SetParameter[Seq[Timestamp]] = SetParameter { (v, pp) =>
    pp.setObject(pp.ps.getConnection.createArrayOf("timestamptz", v.toArray[AnyRef]), Types.ARRAY)
  }

  /** Up to `limit` Output ids after the cursor, in id order (PK range scan). */
  def candidates(after: Option[String], limit: Int): DBIO[Vector[String]] = {
    val cursor = after.getOrElse("")
    sql"SELECT id FROM outputs WHERE id > $cursor ORDER BY id LIMIT $limit".as[String]
  }

  /** History rows of one Output, read only up to `limit` (index-only), so admission is bounded by the budget. */
  def boundedCount(outputId: String, limit: Int): DBIO[Int] =
    sql"SELECT count(*) FROM (SELECT 1 FROM output_snapshot_history WHERE output_id = $outputId LIMIT $limit) x".as[Int].head

  /** Admits candidates in order while the running row total stays within `rowBudget`; the first is always
   *  admitted. Returns the admitted prefix and whether admission stopped before the end of `ids`. */
  def admit(ids: Vector[String], rowBudget: Int)(implicit ec: ExecutionContext): DBIO[(Vector[String], Boolean)] = {
    def go(rest: List[String], taken: Vector[String], used: Int): DBIO[(Vector[String], Boolean)] = rest match {
      case Nil => DBIO.successful((taken, false))
      case id :: tail =>
        val remaining = rowBudget - used
        boundedCount(id, math.max(remaining, 0) + 1).flatMap { n =>
          if (taken.isEmpty) go(tail, taken :+ id, used + n)
          else if (n <= remaining) go(tail, taken :+ id, used + n)
          else DBIO.successful((taken, true))
        }
    }
    go(ids.toList, Vector.empty, 0)
  }

  /** Tier max-age purge for the batch's Outputs. One DELETE: the cutoff is the cap of the PIPELINE owner's
   *  tier; a tier absent from the map uses the strictest cap (as the unbounded purge did). Empty map: none.
   *  `captured_at < strictest` is implied by every tier's own cutoff (the strictest cutoff is the latest), so it
   *  changes no result; it lets the `(output_id, captured_at)` index bound the read to over-cap rows instead of
   *  every row of the batch. */
  def ageDelete(now: Instant, maxAgeByTier: Map[UserTier, Duration], batch: Vector[String]): DBIO[Int] =
    if (maxAgeByTier.isEmpty) DBIO.successful(0)
    else {
      val entries    = maxAgeByTier.toSeq
      val tiers      = entries.map { case (t, _) => UserTier.asString(t) }
      val cutoffs    = entries.map { case (_, d) => Timestamp.from(now.minus(d)) }
      val strictest  = Timestamp.from(now.minus(maxAgeByTier.values.min))
      sqlu"""DELETE FROM output_snapshot_history h
             USING pipelines p, users u
             WHERE h.output_id = ANY($batch) AND h.captured_at < $strictest
               AND h.pipeline_id = p.id AND p.owner_id = u.id
               AND h.captured_at < COALESCE(($cutoffs::timestamptz[])[array_position($tiers::text[], u.tier)], $strictest)"""
    }

  /** The rank-once thin for the batch's Outputs. Within an Output ordered `captured_at DESC, id DESC`,
   *  `age_class` and `floor(epoch / bucket_secs)` are monotone, so each group is contiguous; a row is the
   *  group's newest unprotected row unless the row immediately newer than it is also unprotected and in the
   *  same group. The newer row is unprotected iff `recency - 1 > protectedNewest`. */
  def thin(now: Instant, policy: HistoryThinningPolicy, protectedNewest: Int, batch: Vector[String]): DBIO[Int] = {
    val nowTs        = Timestamp.from(now)
    val recentSecs   = policy.recentWindow.getSeconds
    val midSecs      = policy.midWindow.getSeconds
    val recentBucket = policy.recentBucket.getSeconds
    val midBucket    = policy.midBucket.getSeconds
    val oldBucket    = policy.oldBucket.getSeconds
    val deleteAbove  = protectedNewest + 1
    sqlu"""DELETE FROM output_snapshot_history WHERE output_id = ANY($batch) AND id IN (
             SELECT id FROM (
               SELECT id, age_class, bucket,
                      row_number() OVER w AS recency,
                      lag(age_class) OVER w AS prev_class,
                      lag(bucket) OVER w AS prev_bucket
               FROM (
                 SELECT id, output_id, captured_at,
                        CASE WHEN extract(epoch FROM ($nowTs::timestamptz - captured_at)) < $recentSecs THEN 0
                             WHEN extract(epoch FROM ($nowTs::timestamptz - captured_at)) < $midSecs THEN 1
                             ELSE 2 END AS age_class,
                        floor(extract(epoch FROM captured_at) /
                          CASE WHEN extract(epoch FROM ($nowTs::timestamptz - captured_at)) < $recentSecs THEN $recentBucket
                               WHEN extract(epoch FROM ($nowTs::timestamptz - captured_at)) < $midSecs THEN $midBucket
                               ELSE $oldBucket END) AS bucket
                 FROM output_snapshot_history
                 WHERE output_id = ANY($batch)
               ) classed
               WINDOW w AS (PARTITION BY output_id ORDER BY captured_at DESC, id DESC)
             ) ranked
             WHERE recency > $deleteAbove AND prev_class = age_class AND prev_bucket = bucket)"""
  }
}
